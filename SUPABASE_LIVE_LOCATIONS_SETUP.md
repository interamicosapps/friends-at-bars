# Supabase Live Locations Table Setup

This document contains the SQL commands needed to create the `live_locations` table in your Supabase database.

## Steps

1. Open your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy and paste the SQL below
4. Run the SQL to create the table, indexes, and policies

## SQL Commands

```sql
-- Create live_locations table
CREATE TABLE live_locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  venue_name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

-- Create index for fast venue lookups (filtering by venue and active status)
CREATE INDEX idx_live_locations_venue ON live_locations(venue_name, is_active);

-- Create index for cleanup queries (filtering by last_updated)
CREATE INDEX idx_live_locations_updated ON live_locations(last_updated);

-- Create index for user lookups (for upsert operations)
CREATE INDEX idx_live_locations_user ON live_locations(user_id);

-- Enable Row Level Security (RLS)
ALTER TABLE live_locations ENABLE ROW LEVEL SECURITY;

-- Create policy to allow public read access (for venue counts)
-- Only show active locations
CREATE POLICY "Allow public read access to active locations" 
ON live_locations 
FOR SELECT 
USING (is_active = true);

-- Create policy to allow public insert access (users can add their location)
CREATE POLICY "Allow public insert access" 
ON live_locations 
FOR INSERT 
WITH CHECK (true);

-- Create policy to allow public update access (users can update their location)
CREATE POLICY "Allow public update access" 
ON live_locations 
FOR UPDATE 
USING (true);

-- Enable real-time for the table
ALTER PUBLICATION supabase_realtime ADD TABLE live_locations;

-- Optional: Create a function to automatically update last_updated timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update last_updated on row updates
CREATE TRIGGER update_live_locations_updated_at 
BEFORE UPDATE ON live_locations 
FOR EACH ROW 
EXECUTE FUNCTION update_updated_at_column();
```

## Verification

After running the SQL, verify the setup:

1. Check that the table was created:
   ```sql
   SELECT * FROM live_locations LIMIT 1;
   ```

2. Check that indexes were created:
   ```sql
   SELECT indexname, indexdef 
   FROM pg_indexes 
   WHERE tablename = 'live_locations';
   ```

3. Check that RLS is enabled:
   ```sql
   SELECT tablename, rowsecurity 
   FROM pg_tables 
   WHERE tablename = 'live_locations';
   ```
   (Should show `rowsecurity = true`)

4. Check that real-time is enabled:
   - Go to Database > Replication in Supabase dashboard
   - Verify `live_locations` table is listed

## Notes

- The `user_id` column has a UNIQUE constraint, ensuring one location record per user
- The `is_active` flag allows marking locations as inactive without deleting them
- Indexes are created for common query patterns (venue lookups, cleanup queries, user lookups)
- RLS policies allow public read access to active locations only (for privacy)
- The trigger automatically updates `last_updated` timestamp on any row update
- Real-time is enabled so all clients receive live updates when locations change

## Cleanup Script (Optional)

If you need to clean up stale locations manually, you can run:

```sql
-- Deactivate locations older than 30 minutes
UPDATE live_locations
SET is_active = false
WHERE last_updated < NOW() - INTERVAL '30 minutes'
AND is_active = true;
```
