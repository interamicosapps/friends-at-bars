# Supabase Setup Guide

## 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create an account
2. Create a new project
3. Note your project URL and anon key from Settings > API

## 2. Create Database Table

Run this SQL in your Supabase SQL Editor:

```sql
-- Create checkins table (include date for app compatibility)
CREATE TABLE checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  venue TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;

-- Create policy to allow anyone to read check-ins
CREATE POLICY "Allow public read access" ON checkins
  FOR SELECT USING (true);

-- Create policy to allow anyone to insert check-ins
CREATE POLICY "Allow public insert access" ON checkins
  FOR INSERT WITH CHECK (true);

-- Create policy to allow update/delete (used when resolving conflicts)
CREATE POLICY "Allow public update access" ON checkins FOR UPDATE USING (true);
CREATE POLICY "Allow public delete access" ON checkins FOR DELETE USING (true);

-- Enable real-time for the table
ALTER PUBLICATION supabase_realtime ADD TABLE checkins;
```

**If you already created the table without the `date` column**, run this in the SQL Editor to fix it:

```sql
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS date TEXT;
```

## 3. Environment Variables

Create a `.env.local` file in your project root:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Replace with your actual Supabase project URL and anon key.

## 4. Features Implemented

✅ **Database Integration**

- Check-ins saved to Supabase `checkins` table
- Real-time updates via Supabase Realtime
- Automatic data fetching on map load

✅ **Form Enhancements**

- Loading states during submission
- Error handling for failed saves
- Dual save (local + Supabase) for immediate UI updates

✅ **Map Features**

- Markers highlight based on total check-ins (local + Supabase)
- Real-time marker updates when new check-ins are added
- Popups show all check-ins for each venue

✅ **Real-time Updates**

- Live subscription to database changes
- Automatic UI updates when other users add check-ins
- No polling required - uses WebSocket connection

## 5. Testing

1. Start your development server: `npm run dev`
2. Add check-ins using the form
3. Check your Supabase dashboard to see saved data
4. Open multiple browser tabs to test real-time updates

## 6. Production Considerations

- Consider adding user authentication for better data management
- Implement data validation and sanitization
- Add rate limiting for check-in submissions
- Consider data retention policies for old check-ins
