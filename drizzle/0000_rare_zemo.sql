CREATE TABLE `media_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`provider` text NOT NULL,
	`reference` text NOT NULL,
	`formats` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_media_analyses_expiry` ON `media_analyses` (`expires_at`);--> statement-breakpoint
CREATE TABLE `media_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`analysis_id` text NOT NULL,
	`format_id` text NOT NULL,
	`provider` text NOT NULL,
	`reference` text NOT NULL,
	`state` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_media_jobs_expiry` ON `media_jobs` (`expires_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rate_limits_expiry` ON `rate_limits` (`expires_at`);