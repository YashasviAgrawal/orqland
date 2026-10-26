-- Business-day helpers. Workspaces operate in India Standard Time; these functions make
-- "today", day filters and dashboards independent of the database server's timezone.
CREATE OR REPLACE FUNCTION ist_today() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

CREATE OR REPLACE FUNCTION ist_day_start(d date) RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$ SELECT d::timestamp AT TIME ZONE 'Asia/Kolkata' $$;
