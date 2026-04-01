ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS snapshots_status_check;
ALTER TABLE snapshots ADD CONSTRAINT snapshots_status_check
    CHECK (status IN ('Healthy', 'Warning', 'Unknown', 'Down', 'Partial', 'Maintenance'));
