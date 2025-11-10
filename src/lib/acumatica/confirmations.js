// src/lib/Acumatica/confirmations.js
import AcumaticaService from "./auth/acumaticaService";

/**
 * Library call to mark "deliver window checkmarks" on a Sales Order in Acumatica.
 * Throws on failure; returns parsed Acumatica response on success.
 */
function orderTypeFromNbr(orderNbr = '') {
  // e.g. "C105098" -> "C1"
  const m = String(orderNbr).match(/^[A-Za-z0-9]{2}/);
  return m ? m[0].toUpperCase() : null;
}

export async function writeT3({ orderType, orderNbr }) {
  if (!orderType || !orderNbr) {
    throw new Error("writeT3: orderType and orderNbr are required");
  }



  const {
    ACUMATICA_BASE_URL,
    ACUMATICA_CLIENT_ID,
    ACUMATICA_CLIENT_SECRET,
    ACUMATICA_USERNAME,
    ACUMATICA_PASSWORD,
  } = process.env;

  const restService = new AcumaticaService(
    ACUMATICA_BASE_URL,
    ACUMATICA_CLIENT_ID,
    ACUMATICA_CLIENT_SECRET,
    ACUMATICA_USERNAME,
    ACUMATICA_PASSWORD
  );

  const accessToken = await restService.getToken();

  // Only send what you want to change
  const payload = {
    custom: {
      Document: {
        AttributeTHREEDAY: { type: "CustomBooleanField", value: true },
      },
    },
  };

  // Key-addressed URL avoids ambiguous matches
  const url = `${restService.baseUrl}/entity/Default/24.200.001/SalesOrder?$filter=OrderType eq '${orderType}' and OrderNbr eq '${orderNbr}'`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const raw = await resp.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("[writeT3] Non-JSON SalesOrder response:", raw);
    throw new Error("writeT3: Unexpected SalesOrder response (non-JSON)");
  }

  if (!resp.ok) {
    console.error("[writeT3] Acumatica SalesOrder error:", data);
    const msg = data?.message || "SalesOrder update failed";
    const err = new Error(`writeT3: ${msg}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }

  return data;
}

export async function writeT3Note({ noteID }) {
  if (!noteID) {
    throw new Error("writeT3Note: noteID is required");
  }

  const {
    ACUMATICA_BASE_URL,
    ACUMATICA_CLIENT_ID,
    ACUMATICA_CLIENT_SECRET,
    ACUMATICA_USERNAME,
    ACUMATICA_PASSWORD,
  } = process.env;

  const restService = new AcumaticaService(
    ACUMATICA_BASE_URL,
    ACUMATICA_CLIENT_ID,
    ACUMATICA_CLIENT_SECRET,
    ACUMATICA_USERNAME,
    ACUMATICA_PASSWORD
  );

  const accessToken = await restService.getToken();

  const payload = {
    Summary: { value: "Automation: 3 Day Delivery Notification Sent to Customer" },
    RelatedEntityNoteID: { value: noteID },
  }

  const url = `${restService.baseUrl}/entity/CustomEndpoint/24.200.001/Activity`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const raw = await resp.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("[writeT3Note] Non-JSON Activity response:", raw);
    throw new Error("writeT3Note: Unexpected Activity response (non-JSON)");
  }

  if (!resp.ok) {
    console.error("[writeT3Note] Acumatica Activity error:", data);
    const msg = data?.message || "Activity update failed";
    const err = new Error(`writeT3Note: ${msg}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }

  return data;
}

export async function writeT14({ orderType, orderNbr }) {
  if (!orderType || !orderNbr) {
    throw new Error("writeT14: orderType and orderNbr are required");
  }

  const {
    ACUMATICA_BASE_URL,
    ACUMATICA_CLIENT_ID,
    ACUMATICA_CLIENT_SECRET,
    ACUMATICA_USERNAME,
    ACUMATICA_PASSWORD,
  } = process.env;

  const restService = new AcumaticaService(
    ACUMATICA_BASE_URL,
    ACUMATICA_CLIENT_ID,
    ACUMATICA_CLIENT_SECRET,
    ACUMATICA_USERNAME,
    ACUMATICA_PASSWORD
  );

  const accessToken = await restService.getToken();

  // Only send what you want to change
  const payload = {
    custom: {
      Document: {
        AttributeTWOWEEK: { type: "CustomBooleanField", value: true },
      },
    },
  };

  // Key-addressed URL avoids ambiguous matches
  const url = `${restService.baseUrl}/entity/Default/24.200.001/SalesOrder?$filter=OrderType eq '${orderType}' and OrderNbr eq '${orderNbr}'`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const raw = await resp.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("[writeT14] Non-JSON SalesOrder response:", raw);
    throw new Error("writeT14: Unexpected SalesOrder response (non-JSON)");
  }

  if (!resp.ok) {
    console.error("[writeT14] Acumatica SalesOrder error:", data);
    const msg = data?.message || "SalesOrder update failed";
    const err = new Error(`writeT14: ${msg}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }

  return data;
}

export async function writeT14Note({ noteID }) {
  if (!noteID) {
    throw new Error("writeT14Note: noteID is required");
  }

  const {
    ACUMATICA_BASE_URL,
    ACUMATICA_CLIENT_ID,
    ACUMATICA_CLIENT_SECRET,
    ACUMATICA_USERNAME,
    ACUMATICA_PASSWORD,
  } = process.env;

  const restService = new AcumaticaService(
    ACUMATICA_BASE_URL,
    ACUMATICA_CLIENT_ID,
    ACUMATICA_CLIENT_SECRET,
    ACUMATICA_USERNAME,
    ACUMATICA_PASSWORD
  );

  const accessToken = await restService.getToken();

  const payload = {
    Summary: { value: "Automation: 14 Day Delivery Notification Sent to Customer" },
    RelatedEntityNoteID: { value: noteID },
  }

  const url = `${restService.baseUrl}/entity/CustomEndpoint/24.200.001/Activity`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const raw = await resp.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("[writeT14Note] Non-JSON Activity response:", raw);
    throw new Error("writeT14Note: Unexpected Activity response (non-JSON)");
  }

  if (!resp.ok) {
    console.error("[writeT14Note] Acumatica Activity error:", data);
    const msg = data?.message || "Activity update failed";
    const err = new Error(`writeT14Note: ${msg}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }

  return data;
}

export async function WriteT42Confirm({ orderNbr, confirmVia, confirmWth }) {
  const orderType = orderTypeFromNbr(orderNbr);

  if (!orderType || !orderNbr) {
    throw new Error("writeT42Confirm: orderType and orderNbr are required");
  }

  const {
    ACUMATICA_BASE_URL,
    ACUMATICA_CLIENT_ID,
    ACUMATICA_CLIENT_SECRET,
    ACUMATICA_USERNAME,
    ACUMATICA_PASSWORD,
  } = process.env;

  const restService = new AcumaticaService(
    ACUMATICA_BASE_URL,
    ACUMATICA_CLIENT_ID,
    ACUMATICA_CLIENT_SECRET,
    ACUMATICA_USERNAME,
    ACUMATICA_PASSWORD
  );

  const accessToken = await restService.getToken();

  const payload = {
    custom: {
      Document: {
        AttributeCONFIRMVIA: { type: "CustomStringField", value: confirmVia },
        AttributeCONFIRMWTH: { type: "CustomStringField", value: confirmWth },
      },
    },
  };

  const url = `${restService.baseUrl}/entity/Default/24.200.001/SalesOrder?$filter=OrderType eq '${orderType}' and OrderNbr eq '${orderNbr}'`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const raw = await resp.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("[writeT42Confirm] Non-JSON SalesOrder response:", raw);
    throw new Error("writeT42Confirm: Unexpected SalesOrder response (non-JSON)");
  }

  if (!resp.ok) {
    console.error("[writeT42Confirm] Acumatica SalesOrder error:", data);
    const msg = data?.message || "SalesOrder update failed";
    const err = new Error(`writeT42Confirm: ${msg}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }

  return data;

}

export async function writeT42Note({ noteID }) {
  if (!noteID) {
    throw new Error("writeT42Note: noteID is required");
  }

  const {
    ACUMATICA_BASE_URL,
    ACUMATICA_CLIENT_ID,
    ACUMATICA_CLIENT_SECRET,
    ACUMATICA_USERNAME,
    ACUMATICA_PASSWORD,
  } = process.env;

  const restService = new AcumaticaService(
    ACUMATICA_BASE_URL,
    ACUMATICA_CLIENT_ID,
    ACUMATICA_CLIENT_SECRET,
    ACUMATICA_USERNAME,
    ACUMATICA_PASSWORD
  );

  const accessToken = await restService.getToken();

  const payload = {
    Summary: { value: "Automation: Customer Confirmed 6 Week Delivery Date" },
    RelatedEntityNoteID: { value: noteID },
  }

  const url = `${restService.baseUrl}/entity/CustomEndpoint/24.200.001/Activity`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const raw = await resp.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("[writeT42Note] Non-JSON Activity response:", raw);
    throw new Error("writeT42Note: Unexpected Activity response (non-JSON)");
  }

  if (!resp.ok) {
    console.error("[writeT42Note] Acumatica Activity error:", data);
    const msg = data?.message || "Activity update failed";
    const err = new Error(`writeT42Note: ${msg}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }

  return data;
}


