-- CreateIndex
CREATE INDEX "insp_logs_session_id_idx" ON "insp_logs"("session_id");

-- CreateIndex
CREATE INDEX "insp_logs_type_created_at_idx" ON "insp_logs"("type", "created_at");

-- CreateIndex
CREATE INDEX "insp_sessions_completed_at_idx" ON "insp_sessions"("completed_at");

-- CreateIndex
CREATE INDEX "insp_sessions_completed_at_staff_code_idx" ON "insp_sessions"("completed_at", "staff_code");

-- CreateIndex
CREATE INDEX "thomas_imports_imported_at_idx" ON "thomas_imports"("imported_at");
