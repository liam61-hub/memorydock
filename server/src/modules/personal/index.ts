import type { FastifyInstance } from 'fastify';
import { getTable } from '../../db/lancedb.js';
import { fromRow, withoutVector } from '../../db/schema.js';

/**
 * Get the tenant_id from the request.
 */
function tenantId(request: { tenantId?: string }): string {
  return request.tenantId ?? 'default';
}

/**
 * Register the personal-info query route.
 */
export async function registerPersonalRoutes(app: FastifyInstance) {

  app.get('/api/personal-info', async (request, reply) => {
    const query = request.query as { tags?: string };
    const tid = tenantId(request);

    const table = await getTable();
    const all = await table.query()
      .limit(200)
      .toArray();

    // Filter by content_type + tenant_id
    let rows = all
      .map(r => fromRow(r))
      .filter(r => r.content_type === 'personal_info' && r.tenant_id === tid);

    // Filter by tags
    if (query.tags) {
      const filterTags = query.tags.split(',');
      rows = rows.filter(r => filterTags.some(t => r.tags.includes(t)));
    }

    // Sort by sort_order
    rows.sort((a, b) => {
      const orderA = (a.metadata as Record<string, number>)?.sort_order ?? 99;
      const orderB = (b.metadata as Record<string, number>)?.sort_order ?? 99;
      return orderA - orderB;
    });

    return reply.send({
      status: true,
      data: { items: rows.map(withoutVector) },
    });
  });
}
