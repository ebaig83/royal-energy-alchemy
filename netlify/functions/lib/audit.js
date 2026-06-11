// Writes a row to audit_logs. Called after every write operation.
// Never throws — audit failure should not break the main operation.

const { getClient } = require('./supabase');

async function log({ actor = 'daron', action, tableName, recordId, oldData, newData, context, ip }) {
  try {
    const sb = getClient();
    await sb.from('audit_logs').insert({
      actor,
      action,
      table_name: tableName,
      record_id:  recordId ? String(recordId) : null,
      old_data:   oldData  || null,
      new_data:   newData  || null,
      context:    context  || null,
      ip_address: ip       || null,
    });
  } catch (err) {
    console.error('[audit] Failed to write audit log:', err.message);
  }
}

module.exports = { log };
