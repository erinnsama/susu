import webpush from "web-push";

/**
 * 對資料庫裡每一組訂閱送一則推播，過期/失效（404、410）的訂閱直接刪掉，
 * 不會累積死掉的訂閱一直重試。回傳每組訂閱的結果，方便測試端點回報。
 */
export async function sendPushToAll(env, payload) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

  const { results } = await env.DB.prepare("SELECT * FROM push_subscriptions").all();
  const body = JSON.stringify(payload);
  const outcomes = [];

  for (const row of results) {
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth }
    };
    try {
      await webpush.sendNotification(subscription, body);
      await env.DB.prepare("UPDATE push_subscriptions SET last_sent_at = ? WHERE endpoint = ?")
        .bind(new Date().toISOString(), row.endpoint)
        .run();
      outcomes.push({ endpoint: row.endpoint, ok: true });
    } catch (err) {
      const status = err && err.statusCode;
      if (status === 404 || status === 410) {
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(row.endpoint).run();
      }
      outcomes.push({ endpoint: row.endpoint, ok: false, status, error: String((err && err.message) || err) });
    }
  }
  return outcomes;
}
