-- Migration: Drop journal schema and all related objects
-- Date: 2025-10-20
-- Description: Removes all journal functionality (schema, tables, enums) as part of architecture simplification

-- Drop journal schema with all its tables and objects
DROP SCHEMA IF EXISTS journal CASCADE;

-- Drop journal-related enums (they exist in the public schema)
DROP TYPE IF EXISTS journal_mood CASCADE;
DROP TYPE IF EXISTS journal_energy CASCADE;
