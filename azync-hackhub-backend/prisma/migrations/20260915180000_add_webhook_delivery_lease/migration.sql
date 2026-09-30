ALTER TABLE "GitHubWebhookDelivery"
ADD COLUMN "processingLeaseUntil" TIMESTAMP(3);

CREATE INDEX "GitHubWebhookDelivery_status_processingLeaseUntil_idx"
ON "GitHubWebhookDelivery"("status", "processingLeaseUntil");
