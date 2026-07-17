-- PostgreSQL requires a newly-added enum value to be committed before it can be
-- referenced by a column default. The following migration adds the queue columns.
ALTER TYPE "TestRunStatus" ADD VALUE IF NOT EXISTS 'QUEUED' BEFORE 'RUNNING';
