ALTER TABLE tasks ADD COLUMN completed_at TEXT;

-- 回填在這個欄位出現以前就已經標記完成的任務：用 updated_at 當作完成時間的最佳猜測，
-- 之後新的完成/取消完成動作都會由程式精準寫入 completed_at，不會再依賴這個猜測值。
UPDATE tasks SET completed_at = updated_at WHERE status = 'done' AND completed_at IS NULL;
