-- 每週進度：week_start 是該週週一（台北在地日期），final_text 是她實際交給主管的版本，
-- 下週產生草稿時讀上一份的「[下周進度]」來接續。
CREATE TABLE weekly_reports (
  week_start TEXT PRIMARY KEY,
  final_text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
