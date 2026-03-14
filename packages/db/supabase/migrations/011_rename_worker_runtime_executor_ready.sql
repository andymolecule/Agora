alter table if exists worker_runtime_state
  rename column docker_ready to executor_ready;
