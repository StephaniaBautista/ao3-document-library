import { blob, integer, sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const folders = sqliteTable('folders', {
 id: text('id').primaryKey(), owner: text('owner').notNull(), parentId: text('parent_id'), name: text('name').notNull(), createdAt: integer('created_at').notNull()
}, t => [index('folders_owner_parent').on(t.owner,t.parentId)]);
export const files = sqliteTable('files', {
 id: text('id').primaryKey(), owner: text('owner').notNull(), folderId: text('folder_id'), name: text('name').notNull(), type: text('type').notNull(), size: integer('size').notNull(), objectKey: text('object_key').notNull(), createdAt: integer('created_at').notNull()
}, t => [index('files_owner_folder').on(t.owner,t.folderId)]);


// Better Auth tables. Existing library ownership remains untouched.
export const user = sqliteTable('user', {
 id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
 emailVerified: integer('email_verified', {mode:'boolean'}).notNull().default(false), image: text('image'),
 createdAt: integer('created_at', {mode:'timestamp_ms'}).notNull(), updatedAt: integer('updated_at', {mode:'timestamp_ms'}).notNull(),
});
export const session = sqliteTable('session', {
 id: text('id').primaryKey(), expiresAt: integer('expires_at', {mode:'timestamp_ms'}).notNull(), token: text('token').notNull().unique(),
 createdAt: integer('created_at', {mode:'timestamp_ms'}).notNull(), updatedAt: integer('updated_at', {mode:'timestamp_ms'}).notNull(),
 ipAddress: text('ip_address'), userAgent: text('user_agent'), userId: text('user_id').notNull().references(() => user.id, {onDelete:'cascade'}),
}, t => [index('session_user_id_idx').on(t.userId)]);
export const account = sqliteTable('account', {
 id: text('id').primaryKey(), accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
 userId: text('user_id').notNull().references(() => user.id, {onDelete:'cascade'}), accessToken: text('access_token'),
 refreshToken: text('refresh_token'), idToken: text('id_token'), accessTokenExpiresAt: integer('access_token_expires_at', {mode:'timestamp_ms'}),
 refreshTokenExpiresAt: integer('refresh_token_expires_at', {mode:'timestamp_ms'}), scope: text('scope'), password: text('password'),
 createdAt: integer('created_at', {mode:'timestamp_ms'}).notNull(), updatedAt: integer('updated_at', {mode:'timestamp_ms'}).notNull(),
}, t => [index('account_user_id_idx').on(t.userId)]);
export const verification = sqliteTable('verification', {
 id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
 expiresAt: integer('expires_at', {mode:'timestamp_ms'}).notNull(), createdAt: integer('created_at', {mode:'timestamp_ms'}).notNull(),
 updatedAt: integer('updated_at', {mode:'timestamp_ms'}).notNull(),
}, t => [index('verification_identifier_idx').on(t.identifier)]);
export const rateLimit = sqliteTable('rate_limit', {
 id: text('id').primaryKey(), key: text('key').notNull().unique(), count: integer('count').notNull(), lastRequest: integer('last_request').notNull(),
});

// Shared catalog is separate from the pre-existing private library. Accounts may
// be deleted without deleting contributions, which are anonymized by the FK.
export const libraryProfiles = sqliteTable('library_profiles', {
 userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
 role: text('role', { enum: ['user', 'moderator'] }).notNull().default('user'),
 blocked: integer('blocked', { mode: 'boolean' }).notNull().default(false),
 ageVerified: integer('age_verified', { mode: 'boolean' }).notNull().default(false),
 ageVerificationId: text('age_verification_id'),
 ageVerificationState: text('age_verification_state', { enum: ['pending', 'requires_input', 'processing', 'not_eligible', 'canceled', 'error', 'verified', 'self_declared'] }).notNull().default('pending'),
 ageVerificationNextCheckAt: integer('age_verification_next_check_at'),
 createdAt: integer('created_at').notNull(),
});
export const sharedFolders = sqliteTable('shared_folders', {
 id: text('id').primaryKey(), parentId: text('parent_id'), name: text('name').notNull(),
 createdAt: integer('created_at').notNull(),
}, t => [index('shared_folders_parent').on(t.parentId), uniqueIndex('shared_folders_root_name').on(sql`${t.name} collate nocase`).where(sql`${t.parentId} is null`), uniqueIndex('shared_folders_child_name').on(t.parentId, sql`${t.name} collate nocase`).where(sql`${t.parentId} is not null`)]);
export const sharedStories = sqliteTable('shared_stories', {
 id: text('id').primaryKey(), folderId: text('folder_id').references(() => sharedFolders.id),
 submittedBy: text('submitted_by').references(() => user.id, { onDelete: 'set null' }),
 filename: text('filename').notNull(), fileType: text('file_type', { enum: ['pdf', 'epub', 'html'] }).notNull(),
 size: integer('size').notNull(), objectKey: text('object_key').notNull().unique(),
 contentHash: text('content_hash').notNull().unique(),
 title: text('title').notNull(), author: text('author'), summary: text('summary'),
 fandom: text('fandom'), relationship: text('relationship'), tags: text('tags'), warnings: text('warnings'),
 language: text('language'), rating: text('rating'), category: text('category'), characters: text('characters'),
 wordCount: integer('word_count'), chapterCount: integer('chapter_count'), totalChapters: integer('total_chapters'),
 ao3Url: text('ao3_url'), ao3WorkId: text('ao3_work_id').unique(),
 metadataStatus: text('metadata_status', { enum: ['pending', 'processing', 'done', 'failed'] }).notNull().default('pending'), metadataClaimedAt: integer('metadata_claimed_at'),
 metadataManualFields: text('metadata_manual_fields').notNull().default('{}'),
 createdAt: integer('created_at').notNull(),
}, t => [index('shared_stories_folder').on(t.folderId), index('shared_stories_title').on(t.title)]);
// Temporary operational markers; original objects are deleted, never exposed as trash.
export const objectDeletions = sqliteTable('object_deletions', {
 objectKey: text('object_key').primaryKey(), queuedAt: integer('queued_at').notNull(), deletedAt: integer('deleted_at'),
}, t => [index('object_deletions_pending').on(t.deletedAt, t.queuedAt)]);
export const favoriteCollections = sqliteTable('favorite_collections', {
 id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
 name: text('name').notNull(), createdAt: integer('created_at').notNull(),
}, t => [index('favorite_collections_user').on(t.userId)]);
export const favoriteItems = sqliteTable('favorite_items', {
 id: text('id').primaryKey(), collectionId: text('collection_id').notNull().references(() => favoriteCollections.id, { onDelete: 'cascade' }),
 storyId: text('story_id').notNull().references(() => sharedStories.id, { onDelete: 'cascade' }), createdAt: integer('created_at').notNull(),
}, t => [index('favorite_items_collection').on(t.collectionId), index('favorite_items_story').on(t.storyId), uniqueIndex('favorite_items_collection_story').on(t.collectionId, t.storyId)]);
export const removalRequests = sqliteTable('removal_requests', {
 id: text('id').primaryKey(), requesterId: text('requester_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
 storyId: text('story_id').references(() => sharedStories.id, { onDelete: 'set null' }),
 storyDescription: text('story_description').notNull(), proof: text('proof').notNull(), links: text('links').notNull().default('[]'),
 emailStatus: text('email_status', { enum: ['pending', 'sending', 'sent', 'failed', 'unknown'] }), emailAttemptedAt: integer('email_attempted_at'),
 status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
 createdAt: integer('created_at').notNull(),
}, t => [index('removal_requests_status').on(t.status)]);
export const removalEvidenceImages = sqliteTable('removal_evidence_images', {
 id: text('id').primaryKey(), requestId: text('request_id').notNull().references(() => removalRequests.id, { onDelete: 'cascade' }),
 contentType: text('content_type').notNull(), data: blob('data', { mode: 'buffer' }).notNull(),
}, t => [index('removal_evidence_images_request').on(t.requestId)]);
export const ao3Status = sqliteTable('ao3_status', {
 id: text('id').primaryKey(), state: text('state', { enum: ['unknown', 'up', 'down'] }).notNull().default('unknown'),
 consecutiveSuccesses: integer('consecutive_successes').notNull().default(0), consecutiveFailures: integer('consecutive_failures').notNull().default(0),
 lastCheckedAt: integer('last_checked_at'), recoveredAt: integer('recovered_at'), lastObservation: text('last_observation', { enum: ['success', 'failure', 'uncertain'] }),
});
export const reminders = sqliteTable('reminders', {
 id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
 storyId: text('story_id').notNull().references(() => sharedStories.id, { onDelete: 'cascade' }),
 action: text('action', { enum: ['kudo', 'comment'] }).notNull(), comment: text('comment'), createdAt: integer('created_at').notNull(),
}, t => [index('reminders_user').on(t.userId)]);
export const notificationBatches = sqliteTable('notification_batches', {
 id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
 recoveryAt: integer('recovery_at').notNull(), state: text('state', { enum: ['pending', 'sending', 'sent', 'unknown', 'failed'] }).notNull().default('pending'), attemptedAt: integer('attempted_at'),
 createdAt: integer('created_at').notNull(),
}, t => [uniqueIndex('notification_user_recovery').on(t.userId, t.recoveryAt), index('notification_state').on(t.state)]);
export const notificationItems = sqliteTable('notification_items', {
 id: text('id').primaryKey(), batchId: text('batch_id').notNull().references(() => notificationBatches.id, { onDelete: 'cascade' }),
 reminderId: text('reminder_id').notNull().references(() => reminders.id, { onDelete: 'cascade' }),
}, t => [uniqueIndex('notification_batch_reminder').on(t.batchId, t.reminderId)]);
export const translationCache = sqliteTable('translation_cache', {
 id: text('id').primaryKey(), targetLanguage: text('target_language').notNull(),
 translatedText: text('translated_text').notNull(), createdAt: integer('created_at').notNull(),
});
export const translationJobs = sqliteTable('translation_jobs', {
 id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
 storyId: text('story_id').notNull().references(() => sharedStories.id, { onDelete: 'cascade' }),
 targetLanguage: text('target_language').notNull(), createdAt: integer('created_at').notNull(),
 extractionState: text('extraction_state', { enum: ['pending', 'processing', 'browser', 'done', 'failed'] }).notNull().default('pending'), extractionClaimedAt: integer('extraction_claimed_at'), browserClaim: text('browser_claim'),
 extractionNextPage: integer('extraction_next_page').notNull().default(0), extractionNextPosition: integer('extraction_next_position').notNull().default(0),
 readingPosition: integer('reading_position').notNull().default(0),
}, t => [index('translation_jobs_user').on(t.userId), uniqueIndex('translation_job_user_story_language').on(t.userId, t.storyId, t.targetLanguage)]);
export const translationSegments = sqliteTable('translation_segments', {
 id: text('id').primaryKey(), jobId: text('job_id').notNull().references(() => translationJobs.id, { onDelete: 'cascade' }),
 position: integer('position').notNull(), sourceText: text('source_text').notNull(),
 translatedText: text('translated_text'), state: text('state', { enum: ['pending', 'processing', 'done', 'failed'] }).notNull().default('pending'),
 updatedAt: integer('updated_at').notNull(),
}, t => [uniqueIndex('translation_segments_position').on(t.jobId, t.position), index('translation_segments_state').on(t.state)]);
export const translationBrowserBackups = sqliteTable('translation_browser_backups', {
 jobId: text('job_id').primaryKey().references(() => translationJobs.id, { onDelete: 'cascade' }),
 readingPosition: integer('reading_position').notNull(),
});
export const translationBrowserBackupSegments = sqliteTable('translation_browser_backup_segments', {
 id: text('id').primaryKey(), jobId: text('job_id').notNull().references(() => translationBrowserBackups.jobId, { onDelete: 'cascade' }),
 position: integer('position').notNull(), sourceText: text('source_text').notNull(), translatedText: text('translated_text'),
 state: text('state', { enum: ['pending', 'processing', 'done', 'failed'] }).notNull(), updatedAt: integer('updated_at').notNull(),
}, t => [uniqueIndex('translation_browser_backup_segments_position').on(t.jobId, t.position)]);
export const driveConnections = sqliteTable('drive_connections', {
 userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
 refreshTokenCiphertext: text('refresh_token_ciphertext').notNull(), createdAt: integer('created_at').notNull(),
});
export const privateDriveConnections = sqliteTable('private_drive_connections', {
 userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
 refreshTokenCiphertext: text('refresh_token_ciphertext').notNull(), createdAt: integer('created_at').notNull(),
});
export const driveOauthStates = sqliteTable('drive_oauth_states', {
 stateHash: text('state_hash').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }), expiresAt: integer('expires_at').notNull(), verifierCiphertext: text('verifier_ciphertext'),
});
export const driveImportJobs = sqliteTable('drive_import_jobs', {
 id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
 state: text('state', { enum: ['pending', 'running', 'done', 'failed'] }).notNull().default('pending'),
 createdAt: integer('created_at').notNull(),
});
export const driveImportItems = sqliteTable('drive_import_items', {
 id: text('id').primaryKey(), jobId: text('job_id').notNull().references(() => driveImportJobs.id, { onDelete: 'cascade' }),
 driveId: text('drive_id').notNull(), name: text('name').notNull(), mimeType: text('mime_type').notNull(),
 targetDriveId: text('target_drive_id'), resourceKey: text('resource_key'), parentItemId: text('parent_item_id'),
 parentFolderId: text('parent_folder_id').references(() => sharedFolders.id), catalogFolderId: text('catalog_folder_id').references(() => sharedFolders.id), pageToken: text('page_token'),
 storyId: text('story_id').references(() => sharedStories.id, { onDelete: 'set null' }), duplicate: integer('duplicate', { mode: 'boolean' }).notNull().default(false),
 state: text('state', { enum: ['pending', 'processing', 'done', 'failed'] }).notNull().default('pending'), error: text('error'), updatedAt: integer('updated_at').notNull(),
}, t => [uniqueIndex('drive_import_root_item').on(t.jobId, t.driveId).where(sql`${t.parentItemId} is null`), uniqueIndex('drive_import_child_item').on(t.jobId, t.parentItemId, t.driveId).where(sql`${t.parentItemId} is not null`), index('drive_import_items_state').on(t.state), index('drive_import_items_story_state').on(t.storyId, t.state), index('drive_import_items_job_story_state').on(t.jobId, t.storyId, t.state)]);
export const readingPositions = sqliteTable('reading_positions', {
 id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
 storyId: text('story_id').notNull().references(() => sharedStories.id, { onDelete: 'cascade' }),
 location: text('location').notNull(), updatedAt: integer('updated_at').notNull(),
}, t => [uniqueIndex('reading_position_user_story').on(t.userId, t.storyId)]);
export const readingNotes = sqliteTable('reading_notes', {
 id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
 storyId: text('story_id').notNull().references(() => sharedStories.id, { onDelete: 'cascade' }),
 location: text('location').notNull(), text: text('text'), createdAt: integer('created_at').notNull(),
}, t => [index('reading_notes_user_story').on(t.userId, t.storyId)]);
export const translationCacheRefs = sqliteTable('translation_cache_refs', {
 id: text('id').primaryKey(), cacheId: text('cache_id').notNull().references(() => translationCache.id, { onDelete: 'cascade' }),
 storyId: text('story_id').notNull().references(() => sharedStories.id, { onDelete: 'cascade' }),
}, t => [uniqueIndex('translation_cache_story').on(t.cacheId, t.storyId), index('translation_cache_refs_story').on(t.storyId)]);
export const readingSettings = sqliteTable('reading_settings', {
 userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
 fontSize: integer('font_size').notNull().default(100), fontFamily: text('font_family').notNull().default('serif'),
 lineHeight: text('line_height').notNull().default('1.6'), background: text('background').notNull().default('light'), targetLanguage: text('target_language').notNull().default('es'),
});
