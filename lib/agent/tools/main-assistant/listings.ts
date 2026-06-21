import { tool } from 'ai';
import { z } from 'zod';
import {
  listListings,
  getListing,
  createListing,
  updateListing,
  deleteListing
} from '@/lib/db';
import { broadcastAgencyDataChanged } from '@/lib/events';
import { listLeads, listBookedViewings } from '@/lib/db';
import { listingSchema } from '@/lib/types';
import { formatPrice } from '@/lib/format';
import type { AgentContext } from '@/lib/agent/tools/context';

export function buildListingsTools(ctx: AgentContext) {
  return {
    list_listings: tool({
      description: 'List all property listings.',
      inputSchema: z.object({}),
      execute: async () => {
        const listings = await listListings(ctx.config.agency_id);
        return listings.map((l) => ({
          id: l.id,
          title: l.title,
          address: l.address,
          price: formatPrice(l.price),
          rooms: l.rooms,
          surface_m2: l.surface_m2,
          agent_name: l.agent_name
        }));
      }
    }),

    create_listing: tool({
      description: 'Create a new property listing.',
      inputSchema: listingSchema.omit({ agency_id: true }),
      execute: async (input) => {
        const listing = await createListing({
          ...input,
          agency_id: ctx.config.agency_id,
          image_url: input.image_url ?? null
        });
        broadcastAgencyDataChanged(ctx.config.agency_id);
        return { ok: true, id: listing.id, title: listing.title };
      }
    }),

    update_listing: tool({
      description: 'Update an existing listing (price, title, description, rooms, surface, etc.).',
      inputSchema: listingSchema.partial().extend({ id: z.string() }),
      execute: async ({ id, ...fields }) => {
        const existing = await getListing(id);
        if (!existing) return { error: 'listing_not_found' };
        const updated = await updateListing(id, fields);
        broadcastAgencyDataChanged(ctx.config.agency_id);
        return { ok: true, id: updated.id, title: updated.title };
      }
    }),

    delete_listing: tool({
      description: 'Permanently delete a property listing by ID.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const existing = await getListing(id);
        if (!existing) return { error: 'listing_not_found' };
        if (existing.agency_id !== ctx.config.agency_id) return { error: 'forbidden' };
        await deleteListing(id);
        broadcastAgencyDataChanged(ctx.config.agency_id);
        return { ok: true, id };
      }
    }),

    bulk_import_listings: tool({
      description:
        'Import multiple property listings at once. The agent should parse the admin\'s pasted list/CSV-like text into structured listing objects and pass them here.',
      inputSchema: z.object({
        listings: z.array(listingSchema.omit({ agency_id: true })).min(1).max(50)
      }),
      execute: async ({ listings: items }) => {
        const created: { id: string; title: string }[] = [];
        const failed: { index: number; id?: string; reason: string }[] = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          try {
            const listing = await createListing({
              ...item,
              agency_id: ctx.config.agency_id,
              image_url: item.image_url ?? null
            });
            created.push({ id: listing.id, title: listing.title });
          } catch (err) {
            failed.push({
              index: i,
              id: item.id,
              reason: err instanceof Error ? err.message : String(err)
            });
          }
        }

        if (created.length > 0) broadcastAgencyDataChanged(ctx.config.agency_id);
        return { ok: true, created, failed, total: items.length };
      }
    }),

    set_listing_image: tool({
      description: 'Set the image URL for a listing (tenant-guarded). Agent cannot upload binary files; use a URL.',
      inputSchema: z.object({
        listing_id: z.string(),
        image_url: z.string().url().describe('Public URL of the listing image')
      }),
      execute: async ({ listing_id, image_url }) => {
        const existing = await getListing(listing_id);
        if (!existing || existing.agency_id !== ctx.config.agency_id) return { error: 'listing_not_found' };
        await updateListing(listing_id, { image_url });
        broadcastAgencyDataChanged(ctx.config.agency_id);
        return { ok: true };
      }
    }),

    listing_performance: tool({
      description:
        'Report on each listing: number of leads, qualification rate, bookings, and estimated pipeline value.',
      inputSchema: z.object({}),
      execute: async () => {
        const [allLeads, allViewings, allListings] = await Promise.all([
          listLeads(ctx.config.agency_id),
          listBookedViewings(ctx.config.agency_id),
          listListings(ctx.config.agency_id)
        ]);
        return allListings.map((listing) => {
          const listingLeads = allLeads.filter((l) => l.listing_id === listing.id);
          const bookings = allViewings.filter((v) => v.listing_id === listing.id && v.status !== 'cancelled');
          const hot = listingLeads.filter((l) => l.potential_status === 'hot').length;
          const warm = listingLeads.filter((l) => l.potential_status === 'warm').length;
          const qualified = listingLeads.filter((l) => l.status === 'qualified' || l.status === 'booked').length;
          const conversionRate = listingLeads.length > 0
            ? `${Math.round((bookings.length / listingLeads.length) * 100)}%`
            : '—';
          return {
            listing_id: listing.id,
            title: listing.title,
            price: formatPrice(listing.price),
            total_leads: listingLeads.length,
            hot,
            warm,
            qualified,
            viewings_booked: bookings.length,
            conversion_rate: conversionRate
          };
        });
      }
    })
  };
}
