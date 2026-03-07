// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {HermesErrors} from "./libraries/HermesErrors.sol";
import {HermesEvents} from "./libraries/HermesEvents.sol";
import {HermesConstants} from "./libraries/HermesConstants.sol";
import {IHermesChallenge} from "./interfaces/IHermesChallenge.sol";

contract HermesChallenge is IHermesChallenge, ReentrancyGuard {
    uint256 public constant PROTOCOL_FEE_BPS = 500; // 5%
    uint64 public constant SCORING_GRACE_PERIOD = 7 days;

    IERC20 public immutable usdc;
    address public immutable poster;
    address public oracle;
    address public treasury;
    string public specCid;

    uint256 public override rewardAmount;
    uint64 public override deadline;
    uint64 public override disputeWindowHours;

    DistributionType public override distributionType;
    Status public override status;
    uint256 public override minimumScore;

    uint64 public disputeStartedAt;
    uint256 public winningSubmissionId;
    bool public winnerSet;

    uint256 public scoredCount;

    // Submission limits (0 = unlimited)
    uint256 public maxSubmissions;
    uint256 public maxSubmissionsPerSolver;
    mapping(address => uint256) public solverSubmissionCount;

    Submission[] private submissions;

    mapping(address => uint256) public payoutByAddress;

    constructor(ChallengeConfig memory cfg) {
        if (cfg.poster == address(0) || cfg.oracle == address(0) || cfg.treasury == address(0)) {
            revert HermesErrors.InvalidAddress();
        }
        if (cfg.rewardAmount < HermesConstants.MIN_REWARD_USDC || cfg.rewardAmount > HermesConstants.MAX_REWARD_USDC) {
            revert HermesErrors.InvalidRewardAmount();
        }
        if (cfg.deadline <= block.timestamp) {
            revert HermesErrors.DeadlineInPast();
        }
        if (
            cfg.disputeWindowHours < HermesConstants.MIN_DISPUTE_WINDOW_HOURS
                || cfg.disputeWindowHours > HermesConstants.MAX_DISPUTE_WINDOW_HOURS
        ) {
            revert HermesErrors.InvalidDisputeWindow();
        }
        if (uint8(cfg.distributionType) > uint8(DistributionType.Proportional)) {
            revert HermesErrors.InvalidDistribution();
        }
        if (cfg.maxSubmissionsPerSolver > 0 && cfg.maxSubmissions > 0 && cfg.maxSubmissionsPerSolver > cfg.maxSubmissions) {
            revert HermesErrors.InvalidSubmissionLimits();
        }
        usdc = cfg.usdc;
        poster = cfg.poster;
        oracle = cfg.oracle;
        treasury = cfg.treasury;
        specCid = cfg.specCid;
        rewardAmount = cfg.rewardAmount;
        deadline = cfg.deadline;
        disputeWindowHours = cfg.disputeWindowHours;
        minimumScore = cfg.minimumScore;
        distributionType = cfg.distributionType;
        maxSubmissions = cfg.maxSubmissions;
        maxSubmissionsPerSolver = cfg.maxSubmissionsPerSolver;
        status = Status.Active;
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) revert HermesErrors.NotOracle();
        _;
    }

    modifier onlyPoster() {
        if (msg.sender != poster) revert HermesErrors.NotPoster();
        _;
    }

    function submit(bytes32 resultHash) external override returns (uint256 subId) {
        _updateStatusAfterDeadline();
        if (status != Status.Active) revert HermesErrors.InvalidStatus();
        if (block.timestamp >= deadline) revert HermesErrors.DeadlinePassed();
        if (maxSubmissions > 0 && submissions.length >= maxSubmissions) {
            revert HermesErrors.MaxSubmissionsReached();
        }
        if (maxSubmissionsPerSolver > 0 && solverSubmissionCount[msg.sender] >= maxSubmissionsPerSolver) {
            revert HermesErrors.MaxSubmissionsPerSolverReached();
        }
        solverSubmissionCount[msg.sender]++;
        submissions.push(
            Submission({
                solver: msg.sender,
                resultHash: resultHash,
                proofBundleHash: bytes32(0),
                score: 0,
                submittedAt: uint64(block.timestamp),
                scored: false
            })
        );
        subId = submissions.length - 1;
        emit HermesEvents.Submitted(subId, msg.sender, resultHash);
    }

    function postScore(uint256 subId, uint256 score, bytes32 proofBundleHash) external override onlyOracle {
        _updateStatusAfterDeadline();
        if (status != Status.Scoring) revert HermesErrors.InvalidStatus();
        if (subId >= submissions.length) revert HermesErrors.InvalidSubmission();
        Submission storage submission = submissions[subId];
        if (submission.scored) revert HermesErrors.AlreadyScored();

        submission.scored = true;
        submission.score = score;
        submission.proofBundleHash = proofBundleHash;
        scoredCount++;

        emit HermesEvents.Scored(subId, score, proofBundleHash);
    }

    function finalize() external override nonReentrant {
        _updateStatusAfterDeadline();
        if (status == Status.Disputed) revert HermesErrors.DisputeActive();
        if (status == Status.Cancelled) revert HermesErrors.ChallengeCancelled();
        if (status == Status.Finalized) revert HermesErrors.ChallengeFinalized();
        if (status != Status.Scoring) revert HermesErrors.InvalidStatus();
        if (block.timestamp <= deadline + (uint256(disputeWindowHours) * 1 hours)) {
            revert HermesErrors.DeadlineNotPassed();
        }

        // Scoring completeness check: all scored OR grace period elapsed
        bool allScored = scoredCount >= submissions.length;
        if (!allScored && block.timestamp <= deadline + SCORING_GRACE_PERIOD) {
            revert HermesErrors.ScoringIncomplete();
        }

        (uint256[] memory winners, uint256[] memory scores) = _computeWinners();
        if (winners.length == 0) {
            status = Status.Cancelled;
            if (!usdc.transfer(poster, rewardAmount)) revert HermesErrors.TransferFailed();
            emit HermesEvents.Cancelled();
            return;
        }

        uint256 protocolFee = (rewardAmount * PROTOCOL_FEE_BPS) / 10_000;
        uint256 remaining = rewardAmount - protocolFee;

        if (distributionType == DistributionType.WinnerTakeAll) {
            _setPayout(submissions[winners[0]].solver, remaining);
        } else if (distributionType == DistributionType.TopThree) {
            _setTopThreePayouts(winners, remaining);
        } else if (distributionType == DistributionType.Proportional) {
            _setProportionalPayouts(winners, scores, remaining);
        } else {
            revert HermesErrors.InvalidDistribution();
        }

        status = Status.Finalized;
        winnerSet = true;
        winningSubmissionId = winners[0];

        if (protocolFee > 0) {
            if (!usdc.transfer(treasury, protocolFee)) revert HermesErrors.TransferFailed();
        }

        emit HermesEvents.Finalized(protocolFee, remaining);
    }

    function dispute(string calldata reason) external override {
        _updateStatusAfterDeadline();
        if (block.timestamp <= deadline) revert HermesErrors.DisputeWindowNotStarted();
        if (status == Status.Disputed) revert HermesErrors.DisputeActive();
        if (status == Status.Finalized || status == Status.Cancelled) revert HermesErrors.InvalidStatus();
        if (status != Status.Scoring) revert HermesErrors.InvalidStatus();

        uint256 disputeEnd = deadline + (uint256(disputeWindowHours) * 1 hours);
        if (block.timestamp >= disputeEnd) revert HermesErrors.DisputeWindowClosed();

        status = Status.Disputed;
        disputeStartedAt = uint64(block.timestamp);
        emit HermesEvents.Disputed(msg.sender, reason);
    }

    function resolveDispute(uint256 winnerSubId) external override onlyOracle nonReentrant {
        if (status != Status.Disputed) revert HermesErrors.InvalidStatus();
        if (winnerSubId >= submissions.length) revert HermesErrors.InvalidSubmission();
        if (!submissions[winnerSubId].scored) revert HermesErrors.InvalidSubmission();
        if (submissions[winnerSubId].score < minimumScore) revert HermesErrors.MinimumScoreNotMet();

        uint256 protocolFee = (rewardAmount * PROTOCOL_FEE_BPS) / 10_000;
        uint256 remaining = rewardAmount - protocolFee;

        if (distributionType == DistributionType.WinnerTakeAll) {
            _setPayout(submissions[winnerSubId].solver, remaining);
        } else if (distributionType == DistributionType.TopThree) {
            (uint256[] memory winners, ) = _rankedSubmissions();
            uint256[] memory ranked = _ensureWinnerFirst(winners, winnerSubId, 3);
            _setTopThreePayouts(ranked, remaining);
        } else if (distributionType == DistributionType.Proportional) {
            (uint256[] memory winners, uint256[] memory scores) = _rankedSubmissions();
            (uint256[] memory orderedIds, uint256[] memory orderedScores) = _ensureWinnerFirstWithScores(
                winners,
                scores,
                winnerSubId
            );
            _setProportionalPayouts(orderedIds, orderedScores, remaining);
        } else {
            revert HermesErrors.InvalidDistribution();
        }

        status = Status.Finalized;
        winnerSet = true;
        winningSubmissionId = winnerSubId;

        if (protocolFee > 0) {
            if (!usdc.transfer(treasury, protocolFee)) revert HermesErrors.TransferFailed();
        }

        emit HermesEvents.DisputeResolved(winnerSubId);
    }

    function cancel() external override onlyPoster nonReentrant {
        _updateStatusAfterDeadline();
        if (status != Status.Active) revert HermesErrors.InvalidStatus();
        if (block.timestamp >= deadline) revert HermesErrors.DeadlinePassed();
        if (submissions.length > 0) revert HermesErrors.SubmissionsExist();

        status = Status.Cancelled;
        if (!usdc.transfer(poster, rewardAmount)) revert HermesErrors.TransferFailed();
        emit HermesEvents.Cancelled();
    }

    function timeoutRefund() external override nonReentrant {
        if (status != Status.Disputed) revert HermesErrors.InvalidStatus();
        if (block.timestamp <= disputeStartedAt + 30 days) revert HermesErrors.DeadlineNotPassed();

        status = Status.Cancelled;
        if (!usdc.transfer(poster, rewardAmount)) revert HermesErrors.TransferFailed();
        emit HermesEvents.Cancelled();
    }

    function claim() external override nonReentrant {
        if (status != Status.Finalized) revert HermesErrors.InvalidStatus();
        uint256 payout = payoutByAddress[msg.sender];
        if (payout == 0) revert HermesErrors.NothingToClaim();
        payoutByAddress[msg.sender] = 0;
        if (!usdc.transfer(msg.sender, payout)) revert HermesErrors.TransferFailed();
        emit HermesEvents.Claimed(msg.sender, payout);
    }

    function getSubmission(uint256 subId) external view override returns (Submission memory) {
        if (subId >= submissions.length) revert HermesErrors.InvalidSubmission();
        return submissions[subId];
    }

    function getLeaderboard()
        external
        view
        override
        returns (uint256[] memory subIds, uint256[] memory scores)
    {
        (subIds, scores) = _rankedSubmissions();
    }

    function submissionCount() external view override returns (uint256) {
        return submissions.length;
    }
    function _updateStatusAfterDeadline() internal {
        if (status == Status.Active && block.timestamp >= deadline) {
            status = Status.Scoring;
        }
    }

    function _setPayout(address solver, uint256 amount) internal {
        payoutByAddress[solver] += amount;
    }

    /// @dev Split 70/20/10 among up to 3 winners. When fewer than 3 qualified
    ///      submissions exist, unclaimed shares consolidate on the top scorer.
    ///      E.g. 1 winner receives 100%; 2 winners receive 90%/10%.
    function _setTopThreePayouts(uint256[] memory winners, uint256 remaining) internal {
        uint256 first = (remaining * 70) / 100;
        uint256 second = (remaining * 20) / 100;
        uint256 third = remaining - first - second;

        _setPayout(submissions[winners[0]].solver, first);
        if (winners.length > 1) {
            _setPayout(submissions[winners[1]].solver, second);
        } else {
            _setPayout(submissions[winners[0]].solver, second);
        }
        if (winners.length > 2) {
            _setPayout(submissions[winners[2]].solver, third);
        } else {
            _setPayout(submissions[winners[0]].solver, third);
        }
    }

    function _setProportionalPayouts(
        uint256[] memory winners,
        uint256[] memory scores,
        uint256 remaining
    ) internal {
        uint256 sumScores = 0;
        for (uint256 i = 0; i < scores.length; i++) {
            sumScores += scores[i];
        }
        if (sumScores == 0) {
            _setPayout(submissions[winners[0]].solver, remaining);
            return;
        }
        uint256 totalPaid = 0;
        for (uint256 i = 0; i < winners.length; i++) {
            uint256 payout = (remaining * scores[i]) / sumScores;
            totalPaid += payout;
            _setPayout(submissions[winners[i]].solver, payout);
        }
        if (totalPaid < remaining) {
            uint256 dust = remaining - totalPaid;
            _setPayout(submissions[winners[0]].solver, dust);
        }
    }

    function _computeWinners()
        internal
        view
        returns (uint256[] memory winners, uint256[] memory scores)
    {
        (uint256[] memory rankedIds, uint256[] memory rankedScores) = _rankedSubmissions();
        if (rankedIds.length == 0) {
            return (new uint256[](0), new uint256[](0));
        }
        uint256 count = rankedIds.length;
        if (distributionType == DistributionType.TopThree && count > 3) {
            count = 3;
        }
        winners = new uint256[](count);
        scores = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            winners[i] = rankedIds[i];
            scores[i] = rankedScores[i];
        }
    }

    function _rankedSubmissions()
        internal
        view
        returns (uint256[] memory rankedIds, uint256[] memory rankedScores)
    {
        uint256 subCount = submissions.length;
        if (subCount == 0) {
            return (new uint256[](0), new uint256[](0));
        }

        rankedIds = new uint256[](subCount);
        rankedScores = new uint256[](subCount);

        uint256 qualifiedCount = 0;
        for (uint256 i = 0; i < subCount; i++) {
            if (submissions[i].scored && submissions[i].score >= minimumScore) {
                rankedIds[qualifiedCount] = i;
                rankedScores[qualifiedCount] = submissions[i].score;
                qualifiedCount++;
            }
        }

        if (qualifiedCount == 0) {
            return (new uint256[](0), new uint256[](0));
        }

        // Trim arrays to qualifiedCount
        uint256[] memory ids = new uint256[](qualifiedCount);
        uint256[] memory scores = new uint256[](qualifiedCount);
        for (uint256 i = 0; i < qualifiedCount; i++) {
            ids[i] = rankedIds[i];
            scores[i] = rankedScores[i];
        }

        // Simple selection sort (qualifiedCount is expected to be small)
        for (uint256 i = 0; i < qualifiedCount; i++) {
            uint256 bestIndex = i;
            for (uint256 j = i + 1; j < qualifiedCount; j++) {
                if (scores[j] > scores[bestIndex]) {
                    bestIndex = j;
                }
            }
            if (bestIndex != i) {
                (scores[i], scores[bestIndex]) = (scores[bestIndex], scores[i]);
                (ids[i], ids[bestIndex]) = (ids[bestIndex], ids[i]);
            }
        }

        return (ids, scores);
    }

    function _ensureWinnerFirst(
        uint256[] memory ranked,
        uint256 winnerSubId,
        uint256 maxCount
    ) internal pure returns (uint256[] memory winners) {
        uint256 count = ranked.length;
        if (count > maxCount) {
            count = maxCount;
        }
        winners = new uint256[](count);
        winners[0] = winnerSubId;

        uint256 idx = 1;
        for (uint256 i = 0; i < ranked.length && idx < count; i++) {
            if (ranked[i] == winnerSubId) continue;
            winners[idx] = ranked[i];
            idx++;
        }
    }

    function _ensureWinnerFirstWithScores(
        uint256[] memory rankedIds,
        uint256[] memory rankedScores,
        uint256 winnerSubId
    ) internal pure returns (uint256[] memory ids, uint256[] memory scores) {
        ids = new uint256[](rankedIds.length);
        scores = new uint256[](rankedScores.length);
        if (rankedIds.length == 0) {
            return (ids, scores);
        }

        uint256 winnerIndex = 0;
        for (uint256 i = 0; i < rankedIds.length; i++) {
            if (rankedIds[i] == winnerSubId) {
                winnerIndex = i;
                break;
            }
        }

        ids[0] = winnerSubId;
        scores[0] = rankedScores[winnerIndex];

        uint256 idx = 1;
        for (uint256 i = 0; i < rankedIds.length; i++) {
            if (i == winnerIndex) continue;
            ids[idx] = rankedIds[i];
            scores[idx] = rankedScores[i];
            idx++;
        }
    }
}
