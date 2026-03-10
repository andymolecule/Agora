update submissions
set result_format = 'sealed_submission_v2'
where result_format = 'sealed_v1';

alter table submissions
  drop constraint if exists submissions_result_format_check;

alter table submissions
  add constraint submissions_result_format_check
  check (result_format in ('plain_v0', 'sealed_submission_v2'));
