declare namespace Cloudflare {
  interface Env {
    BREVO_API_KEY?: string;
    REMOVAL_REQUEST_EMAIL?: string;
    BREVO_FROM_EMAIL?: string;
    BREVO_FROM_NAME?: string;
    POSTMARK_SERVER_TOKEN?: string;
    POSTMARK_FROM_EMAIL?: string;
    POSTMARK_MESSAGE_STREAM?: string;
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_URL?: string;
    LIBRARY_ADMIN_USER_ID?: string;
    STRIPE_IDENTITY_SECRET_KEY?: string;
    GOOGLE_TRANSLATE_API_KEY?: string;
    GOOGLE_OAUTH_CLIENT_ID?: string;
    GOOGLE_OAUTH_CLIENT_SECRET?: string;
    DRIVE_TOKEN_ENCRYPTION_KEY?: string;
    EXTRACTOR_URL?: string;
    EXTRACTOR_TOKEN?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
