import prisma from "@/lib/prisma/prisma";
import AcumaticaService from "@/lib/acumatica/auth/acumaticaService";

const BUSINESS_ACCOUNT_ID = "BA0021728"; // hardcoded BA
const OWNER_ID = "106615";              // hardcoded owner
const TAX_ZONE = "SALT LAKE";
const COUNTRY = "US";

/**
 * Build a LocationID from first initial + last name
 * - uppercased
 * - max 10 chars
 * - falls back to WEBLOCATION if something is missing
 */
function buildLocationId(firstName, lastName) {
  const first = (firstName || "").trim();
  const last = (lastName || "").trim();

  if (!first && !last) return "WEBLOCATION";

  const base = `${first.charAt(0)}${last}`.toUpperCase();
  return base.slice(0, 10); // Acumatica only considers first 10 chars
}

/**
 * Fetch an existing CustomerLocation for this email+customer,
 * or return null if none exists.
 */
async function findExistingLocation(restService, token, email) {
  const baseUrl = restService.baseUrl;
  const customer = BUSINESS_ACCOUNT_ID;

  const filter = encodeURIComponent(
    `LocationEmail eq '${email}' and Customer eq '${customer}'`
  );

  const url = `${baseUrl}/entity/CustomEndpoint/24.200.001/CustomerLocation?$filter=${filter}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Failed to fetch CustomerLocation: ${res.status} ${res.statusText} - ${body}`
    );
  }

  const data = await res.json();

  if (Array.isArray(data) && data.length > 0) {
    return data[0];
  }

  return null;
}

/**
 * Create a new CustomerLocation for this quote.
 * Returns the LocationID that should be used on the Opportunity.
 */
async function createCustomerLocation(restService, token, quote) {
  const baseUrl = restService.baseUrl;

  const locationId = buildLocationId(quote.firstName, quote.lastName);
  const locationName = `${quote.firstName} ${quote.lastName}`.trim();

  const payload = {
    Customer: { value: BUSINESS_ACCOUNT_ID },
    LocationID: { value: locationId },
    AddressOverride: { value: true },
    ContactOverride: { value: true },
    TaxZone: { value: TAX_ZONE },
    LocationName: { value: locationName || locationId },
    LocationContact: {
      Email: { value: quote.email },
      Phone1: { value: quote.phone },
      Address: {
        AddressLine1: { value: quote.address1 },
        ...(quote.address2
          ? { AddressLine2: { value: quote.address2 } }
          : {}),
        City: { value: quote.city },
        Country: { value: COUNTRY },
        PostalCode: { value: quote.zip },
        State: { value: quote.state },
      },
    },
  };

  const res = await fetch(
    `${baseUrl}/entity/CustomEndpoint/24.200.001/CustomerLocation`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Failed to create CustomerLocation: ${res.status} ${res.statusText} - ${body}`
    );
  }

  const created = await res.json();
  return created?.LocationID?.value || locationId;
}

/**
 * Build the Opportunity payload from the quote + locationId.
 */
function buildOpportunityPayload(quote, locationId) {
  const cartItems = Array.isArray(quote.cart) ? quote.cart : [];

  const products = cartItems
    .map((item) => {
      // Prefer acumaticaSku, fallback to modelNumber if needed
      const inventoryId = item.acumaticaSku;
      if (!inventoryId) return null;

      return {
        InventoryID: {
          value: inventoryId,
        },
      };
    })
    .filter(Boolean);

  if (!products.length) {
    throw new Error("Quote cart has no items with acumaticaSku/modelNumber.");
  }

  return {
    ClassID: { value: "APP" },
    Subject: { value: "Closeout Opportunity" },
    Override: { value: true },
    BusinessAccount: { value: BUSINESS_ACCOUNT_ID },
    Location: { value: locationId },
    Owner: { value: OWNER_ID },
    Products: products,
    ContactInformation: {
      FirstName: { value: quote.firstName },
      LastName: { value: quote.lastName },
      CompanyName: { value: quote.company || "" },
      Email: { value: quote.email },
      Phone1: { value: quote.phone },
    },
    Address: {
      AddressLine1: { value: quote.address1 },
      ...(quote.address2 ? { AddressLine2: { value: quote.address2 } } : {}),
      City: { value: quote.city },
      Country: { value: COUNTRY },
      PostalCode: { value: quote.zip },
      State: { value: quote.state },
    },
  };
}

/**
 * Core function: take a QuoteRequest row and create an Opportunity in Acumatica.
 * This is what you’ll eventually call from a cron job.
 */
async function createOpportunityFromQuote(quoteId) {
  // 1) Load the quote
  const quote = await prisma.quoteRequest.findUnique({
    where: { id: quoteId },
  });

  if (!quote) {
    throw new Error(`QuoteRequest not found for id: ${quoteId}`);
  }

  // 2) Init Acumatica service + token
  const {
    ACUMATICA_BASE_URL,
    ACUMATICA_CLIENT_ID,
    ACUMATICA_CLIENT_SECRET,
    ACUMATICA_USERNAME,
    ACUMATICA_PASSWORD,
  } = process.env;

  if (!ACUMATICA_BASE_URL) {
    throw new Error("ACUMATICA_BASE_URL is not configured.");
  }

  const restService = new AcumaticaService(
    ACUMATICA_BASE_URL,
    ACUMATICA_CLIENT_ID,
    ACUMATICA_CLIENT_SECRET,
    ACUMATICA_USERNAME,
    ACUMATICA_PASSWORD
  );

  const token = await restService.getToken();

  // 3) Get or create CustomerLocation for this email
  const existingLoc = await findExistingLocation(
    restService,
    token,
    quote.email
  );

  let locationId;

  if (existingLoc) {
    locationId = existingLoc?.LocationID?.value;
    if (!locationId) {
      throw new Error("Existing CustomerLocation is missing LocationID.");
    }
  } else {
    locationId = await createCustomerLocation(restService, token, quote);
  }

  // 4) Build opportunity payload
  const opportunityData = buildOpportunityPayload(quote, locationId);

  // 5) Create opportunity in Acumatica — **Default/24.200.001/Opportunity**
  const oppUrl = `${ACUMATICA_BASE_URL}/entity/Default/24.200.001/Opportunity`;

  console.log("Making PUT request to:", oppUrl);
  console.log("Payload:", JSON.stringify(opportunityData, null, 2));

  const oppRes = await fetch(oppUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(opportunityData),
  });

  if (!oppRes.ok) {
    const body = await oppRes.text();
    console.error("PUT request failed:", body);
    throw new Error(
      `Failed to create opportunity: ${oppRes.status} ${oppRes.statusText} - ${body}`
    );
  }

  const createdOpp = await oppRes.json();

  // 6) Mark quote as processed
  await prisma.quoteRequest.update({
    where: { id: quote.id },
    data: {
      status: "opportunity-created",
      updatedAt: new Date(),
    },
  });

  return {
    quoteId: quote.id,
    locationId,
    opportunity: createdOpp,
  };
}

// ─────────────────────────────────────────────────────────────
// API Route: POST /api/acumatica/opportunity/[id]
// ─────────────────────────────────────────────────────────────

export async function POST(_req, context) {
  try {
    // 👇 params is now a Promise in the app router — await it
    const { id } = await context.params;

    if (!id || typeof id !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid quote id." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const result = await createOpportunityFromQuote(id);

    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error creating closeout opportunity:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || "Failed to create opportunity.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
