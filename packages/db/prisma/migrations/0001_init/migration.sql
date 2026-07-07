CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "coverage_level" AS ENUM ('BASIC', 'STANDARD', 'COMPLETE');
CREATE TYPE "module_key" AS ENUM (
  'market-overview',
  'policy',
  'risk',
  'opportunities',
  'projects',
  'partners',
  'chinese-companies',
  'entry-strategy',
  'ai-advisor',
  'reports'
);
CREATE TYPE "review_status" AS ENUM ('draft', 'pending', 'published');
CREATE TYPE "credibility" AS ENUM ('OFFICIAL', 'VERIFIED', 'ESTIMATED', 'UNVERIFIED');
CREATE TYPE "module_coverage_status" AS ENUM ('BUILDING', 'PARTIAL', 'COMPLETE');
CREATE TYPE "risk_level" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "project_status" AS ENUM ('PLANNING', 'BIDDING', 'CONSTRUCTION', 'OPERATIONAL');
CREATE TYPE "access_level" AS ENUM ('FREE', 'MEMBER', 'PREMIUM');
CREATE TYPE "industry_tag" AS ENUM (
  'solar',
  'wind',
  'storage',
  'ev',
  'hydrogen',
  'grid',
  'bess-mfg',
  'epc'
);
CREATE TYPE "tech_tag" AS ENUM (
  'pv-module',
  'inverter',
  'onshore-wind',
  'offshore-wind',
  'lfp',
  'ncm',
  'electrolyzer'
);
CREATE TYPE "region" AS ENUM (
  'southeast-asia',
  'south-asia',
  'middle-east',
  'africa',
  'latin-america',
  'europe',
  'central-asia'
);
CREATE TYPE "policy_type" AS ENUM (
  'incentive',
  'tariff',
  'localization',
  'permit',
  'tax',
  'import-export'
);

CREATE TABLE "countries" (
  "code" VARCHAR(2) PRIMARY KEY,
  "name" JSONB NOT NULL,
  "region" "region" NOT NULL,
  "coverage_level" "coverage_level" NOT NULL,
  "flag_emoji" TEXT NOT NULL,
  "summary" JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "module_coverages" (
  "id" TEXT PRIMARY KEY,
  "module_key" "module_key" NOT NULL,
  "status" "module_coverage_status" NOT NULL,
  "data_count" INTEGER NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "country_code" VARCHAR(2) NOT NULL REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "module_coverages_country_code_module_key_key" UNIQUE ("country_code", "module_key")
);

CREATE TABLE "market_overviews" (
  "id" TEXT PRIMARY KEY,
  "overview" JSONB NOT NULL,
  "population" INTEGER,
  "gdp" DOUBLE PRECISION,
  "gdp_growth" DOUBLE PRECISION,
  "energy_demand" JSONB NOT NULL,
  "renewable_target" JSONB NOT NULL,
  "key_indicators" JSONB NOT NULL,
  "source" TEXT NOT NULL,
  "source_url" TEXT,
  "collected_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "credibility" "credibility" NOT NULL,
  "review_status" "review_status" NOT NULL,
  "ai_usable" BOOLEAN NOT NULL,
  "country_code" VARCHAR(2) NOT NULL REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  "industry_tags" "industry_tag"[] NOT NULL,
  "tech_tags" "tech_tag"[] NOT NULL,
  CONSTRAINT "market_overviews_country_code_key" UNIQUE ("country_code")
);

CREATE TABLE "policies" (
  "id" TEXT PRIMARY KEY,
  "title" JSONB NOT NULL,
  "summary" JSONB NOT NULL,
  "body" JSONB NOT NULL,
  "policy_type" "policy_type" NOT NULL,
  "effective_date" TIMESTAMP(3),
  "authority" JSONB NOT NULL,
  "source" TEXT NOT NULL,
  "source_url" TEXT,
  "collected_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "credibility" "credibility" NOT NULL,
  "review_status" "review_status" NOT NULL,
  "ai_usable" BOOLEAN NOT NULL,
  "country_code" VARCHAR(2) NOT NULL REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  "industry_tags" "industry_tag"[] NOT NULL,
  "tech_tags" "tech_tag"[] NOT NULL
);

CREATE TABLE "risks" (
  "id" TEXT PRIMARY KEY,
  "title" JSONB NOT NULL,
  "category" TEXT NOT NULL,
  "level" "risk_level" NOT NULL,
  "description" JSONB NOT NULL,
  "mitigation" JSONB NOT NULL,
  "source" TEXT NOT NULL,
  "source_url" TEXT,
  "collected_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "credibility" "credibility" NOT NULL,
  "review_status" "review_status" NOT NULL,
  "ai_usable" BOOLEAN NOT NULL,
  "country_code" VARCHAR(2) NOT NULL REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  "industry_tags" "industry_tag"[] NOT NULL,
  "tech_tags" "tech_tag"[] NOT NULL
);

CREATE TABLE "opportunities" (
  "id" TEXT PRIMARY KEY,
  "title" JSONB NOT NULL,
  "description" JSONB NOT NULL,
  "market_size" JSONB,
  "time_window" JSONB,
  "source" TEXT NOT NULL,
  "source_url" TEXT,
  "collected_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "credibility" "credibility" NOT NULL,
  "review_status" "review_status" NOT NULL,
  "ai_usable" BOOLEAN NOT NULL,
  "country_code" VARCHAR(2) NOT NULL REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  "industry_tags" "industry_tag"[] NOT NULL,
  "tech_tags" "tech_tag"[] NOT NULL
);

CREATE TABLE "projects" (
  "id" TEXT PRIMARY KEY,
  "name" JSONB NOT NULL,
  "description" JSONB NOT NULL,
  "status" "project_status" NOT NULL,
  "capacity" TEXT,
  "investment" DOUBLE PRECISION,
  "location" JSONB,
  "source" TEXT NOT NULL,
  "source_url" TEXT,
  "collected_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "credibility" "credibility" NOT NULL,
  "review_status" "review_status" NOT NULL,
  "ai_usable" BOOLEAN NOT NULL,
  "country_code" VARCHAR(2) NOT NULL REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  "industry_tags" "industry_tag"[] NOT NULL,
  "tech_tags" "tech_tag"[] NOT NULL
);

CREATE TABLE "partners" (
  "id" TEXT PRIMARY KEY,
  "name" JSONB NOT NULL,
  "partner_type" TEXT NOT NULL,
  "description" JSONB NOT NULL,
  "contact_hint" JSONB,
  "source" TEXT NOT NULL,
  "source_url" TEXT,
  "collected_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "credibility" "credibility" NOT NULL,
  "review_status" "review_status" NOT NULL,
  "ai_usable" BOOLEAN NOT NULL,
  "country_code" VARCHAR(2) NOT NULL REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  "industry_tags" "industry_tag"[] NOT NULL,
  "tech_tags" "tech_tag"[] NOT NULL
);

CREATE TABLE "chinese_companies" (
  "id" TEXT PRIMARY KEY,
  "name" JSONB NOT NULL,
  "industry" TEXT NOT NULL,
  "business_scope" JSONB NOT NULL,
  "entry_year" INTEGER,
  "case_study" JSONB,
  "source" TEXT NOT NULL,
  "source_url" TEXT,
  "collected_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "credibility" "credibility" NOT NULL,
  "review_status" "review_status" NOT NULL,
  "ai_usable" BOOLEAN NOT NULL,
  "country_code" VARCHAR(2) NOT NULL REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  "industry_tags" "industry_tag"[] NOT NULL,
  "tech_tags" "tech_tag"[] NOT NULL
);

CREATE TABLE "entry_strategies" (
  "id" TEXT PRIMARY KEY,
  "overview" JSONB NOT NULL,
  "steps" JSONB NOT NULL,
  "recommended_mode" JSONB NOT NULL,
  "source" TEXT NOT NULL,
  "source_url" TEXT,
  "collected_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "credibility" "credibility" NOT NULL,
  "review_status" "review_status" NOT NULL,
  "ai_usable" BOOLEAN NOT NULL,
  "country_code" VARCHAR(2) NOT NULL REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  "industry_tags" "industry_tag"[] NOT NULL,
  "tech_tags" "tech_tag"[] NOT NULL,
  CONSTRAINT "entry_strategies_country_code_key" UNIQUE ("country_code")
);

CREATE TABLE "reports" (
  "id" TEXT PRIMARY KEY,
  "title" JSONB NOT NULL,
  "abstract" JSONB NOT NULL,
  "file_url" TEXT NOT NULL,
  "published_at" TIMESTAMP(3) NOT NULL,
  "access_level" "access_level" NOT NULL,
  "source" TEXT NOT NULL,
  "source_url" TEXT,
  "collected_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "credibility" "credibility" NOT NULL,
  "review_status" "review_status" NOT NULL,
  "ai_usable" BOOLEAN NOT NULL,
  "country_code" VARCHAR(2) NOT NULL REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  "industry_tags" "industry_tag"[] NOT NULL,
  "tech_tags" "tech_tag"[] NOT NULL
);

CREATE TABLE "knowledge_chunks" (
  "id" TEXT PRIMARY KEY,
  "content" JSONB NOT NULL,
  "embedding_zh" vector NOT NULL,
  "embedding_en" vector NOT NULL,
  "source_module" "module_key" NOT NULL,
  "source_id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "source_url" TEXT,
  "collected_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "credibility" "credibility" NOT NULL,
  "review_status" "review_status" NOT NULL,
  "ai_usable" BOOLEAN NOT NULL,
  "country_code" VARCHAR(2) NOT NULL REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  "industry_tags" "industry_tag"[] NOT NULL,
  "tech_tags" "tech_tag"[] NOT NULL
);

CREATE TABLE "leads" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "company" TEXT,
  "contact" TEXT NOT NULL,
  "interested_country" VARCHAR(2),
  "source" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
