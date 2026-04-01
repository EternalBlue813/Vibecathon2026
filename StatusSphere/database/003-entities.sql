-- Migration: Create entities table for banks, CDNs, and cloud providers.
-- Run this after 002-add-banks.sql.

-- 1. ENTITIES - Master table for all tracked entities
CREATE TABLE entities (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('bank', 'cdn', 'cloud')),
    url TEXT NOT NULL,
    status_page_url TEXT,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_entities_slug ON entities (slug);
CREATE INDEX idx_entities_type ON entities (type);
CREATE INDEX idx_entities_active ON entities (is_active);

-- 2. SEED DATA - Cloud Providers
INSERT INTO entities (slug, name, type, url, status_page_url) VALUES
    ('aws', 'Amazon Web Services', 'cloud', 'https://aws.amazon.com', 'https://health.aws.amazon.com/health/status'),
    ('azure', 'Microsoft Azure', 'cloud', 'https://azure.microsoft.com', 'https://status.azure.com'),
    ('gcp', 'Google Cloud Platform', 'cloud', 'https://cloud.google.com', 'https://status.cloud.google.com');

-- 3. SEED DATA - CDNs
INSERT INTO entities (slug, name, type, url, status_page_url) VALUES
    ('cloudflare', 'Cloudflare', 'cdn', 'https://www.cloudflare.com', 'https://www.cloudflarestatus.com'),
    ('akamai', 'Akamai', 'cdn', 'https://www.akamai.com', 'https://status.akamai.com'),
    ('imperva', 'Imperva', 'cdn', 'https://www.imperva.com', 'https://status.imperva.com');

-- 4. SEED DATA - Banks (Singapore/Major Asia)
INSERT INTO entities (slug, name, type, url, status_page_url) VALUES
    ('dbs', 'DBS Bank', 'bank', 'https://www.dbs.com.sg', 'https://www.dbs.com.sg/personal'),
    ('ocbc', 'OCBC Bank', 'bank', 'https://www.ocbc.com', 'https://www.ocbc.com/personal-banking/'),
    ('uob', 'UOB', 'bank', 'https://www.uob.com.sg', 'https://www.uob.com.sg/personal/online-banking/index.page'),
    ('citi', 'Citibank', 'bank', 'https://www.citibank.com.sg', 'https://www.citibank.com.sg/SGGCB/JSO/username/signon/flow.action'),
    ('scb', 'Standard Chartered Bank', 'bank', 'https://www.sc.com/sg', 'https://retail.sc.com/sg/nfs/login.htm'),
    ('hsbc', 'HSBC', 'bank', 'https://www.hsbc.com.sg', 'https://www.hsbc.com.sg/security/'),
    ('maybank', 'Maybank', 'bank', 'https://www.maybank.com.sg', 'https://www.maybank.com.sg/'),
    ('sxp', 'SXP Bank', 'bank', 'https://fake-bank-front-nine.vercel.app', 'https://fake-bank-front-nine.vercel.app/login');

-- 5. Drop hardcoded CHECK constraint on snapshots - entities table is now the source of truth
ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS snapshots_provider_check;

-- 6. Add foreign key to entities table
ALTER TABLE snapshots ADD CONSTRAINT fk_snapshots_entity
    FOREIGN KEY (provider) REFERENCES entities(slug) ON DELETE CASCADE;
