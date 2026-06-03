const siteUrl = process.env.JIRA_SITE_URL || "https://golfnow.atlassian.net";
const cloudId = process.env.JIRA_CLOUD_ID || "";
const email = process.env.JIRA_EMAIL || "";
const token = process.env.JIRA_MCP_TOKEN;

const maxItems = 100;
const maxImagesPerItem = 4;
const maxImagesTotal = 16;
const maxImageDataChars = 2500000;
const maxPayloadImageChars = 12000000;

function truncate(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function safeFilename(value, fallback) {
  const name = String(value || fallback || "checklist-image.jpg")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  return name || fallback || "checklist-image.jpg";
}

function sanitizeImage(image, itemIndex, imageIndex) {
  const dataUrl = String(image?.dataUrl || "");
  const mimeType = String(image?.mimeType || "").toLowerCase();
  const isSupported = /^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl);

  if (!isSupported || dataUrl.length > maxImageDataChars) {
    return null;
  }

  return {
    id: String(image?.id || `image-${itemIndex + 1}-${imageIndex + 1}`),
    name: safeFilename(image?.name, `checklist-${itemIndex + 1}-${imageIndex + 1}.jpg`),
    mimeType: mimeType && mimeType.startsWith("image/") ? mimeType : "image/jpeg",
    dataUrl,
    width: Number.isFinite(Number(image?.width)) ? Math.max(1, Math.round(Number(image.width))) : 800,
    height: Number.isFinite(Number(image?.height)) ? Math.max(1, Math.round(Number(image.height))) : 600,
  };
}

function sanitizeChecklistPayload(payload) {
  const issueKey = String(payload?.issueKey || "").trim().toUpperCase();
  const items = Array.isArray(payload?.items) ? payload.items : [];

  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey)) {
    throw new Error("Invalid Jira issue key.");
  }

  if (!items.length) {
    throw new Error("Checklist must include at least one item.");
  }

  if (items.length > maxItems) {
    throw new Error("Checklist has too many items.");
  }

  let imageCount = 0;
  let imageDataChars = 0;
  const sanitizedItems = items.map((item, itemIndex) => {
    const rawImages = Array.isArray(item?.images) ? item.images : [];
    const images = [];

    for (let imageIndex = 0; imageIndex < rawImages.length; imageIndex += 1) {
      if (images.length >= maxImagesPerItem || imageCount >= maxImagesTotal) {
        break;
      }

      const image = sanitizeImage(rawImages[imageIndex], itemIndex, imageIndex);
      if (!image) {
        continue;
      }

      imageDataChars += image.dataUrl.length;
      if (imageDataChars > maxPayloadImageChars) {
        throw new Error("Checklist images are too large to post. Attach fewer or smaller images.");
      }

      imageCount += 1;
      images.push(image);
    }

    return {
      title: truncate(item?.title || "Untitled test case", 500),
      done: Boolean(item?.done),
      notes: truncate(item?.notes || "", 1200),
      images,
    };
  });

  return {
    issueKey,
    issueUrl: String(payload?.issueUrl || ""),
    summary: truncate(payload?.summary || "", 300),
    releaseVersion: String(payload?.releaseVersion || ""),
    dashboardUrl: String(payload?.dashboardUrl || ""),
    sourceFiles: (Array.isArray(payload?.sourceFiles) ? payload.sourceFiles : [])
      .map((file) => truncate(file, 220))
      .filter(Boolean),
    items: sanitizedItems,
  };
}

function hasChecklistImages(payload) {
  return (payload?.items || []).some((item) => Array.isArray(item.images) && item.images.length);
}

function authHeader() {
  if (!token) {
    throw new Error("JIRA_MCP_TOKEN is not set.");
  }
  if (!cloudId || !email) {
    throw new Error("JIRA_CLOUD_ID and JIRA_EMAIL must be set.");
  }
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

async function jiraApiFetch(apiPath, options = {}) {
  const response = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3${apiPath}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Jira API failed: HTTP ${response.status} ${response.statusText}\n${text}`);
  }

  return text ? JSON.parse(text) : null;
}

async function jiraSiteFetch(pathname, options = {}) {
  const response = await fetch(`${siteUrl}${pathname}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      Accept: options.accept || "text/html,application/xhtml+xml,application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Jira site request failed: HTTP ${response.status} ${response.statusText}\n${text}`);
  }

  return text;
}

function textNode(value) {
  return {
    type: "text",
    text: String(value || ""),
  };
}

function paragraph(value) {
  const text = String(value || "");
  return {
    type: "paragraph",
    content: text ? [textNode(text)] : [],
  };
}

function tableCell(value, header = false) {
  return {
    type: header ? "tableHeader" : "tableCell",
    attrs: {},
    content: [paragraph(value)],
  };
}

function tableRow(values, header = false) {
  return {
    type: "tableRow",
    content: values.map((value) => tableCell(value, header)),
  };
}

function mediaSingle(upload) {
  return {
    type: "mediaSingle",
    attrs: {
      layout: "center",
    },
    content: [
      {
        type: "media",
        attrs: {
          id: upload.mediaId,
          type: "file",
          collection: "",
          width: upload.width,
          height: upload.height,
        },
      },
    ],
  };
}

function buildCommentBody(payload, uploadsByItem = new Map()) {
  const items = payload.items.map((item, index) => {
    const uploads = uploadsByItem.get(index) || [];
    return {
      number: String(index + 1),
      status: item.done ? "Complete" : "Open",
      title: truncate(item.title || "Untitled test case", 500),
      notes: truncate(item.notes || "", 1000),
      imageSummary: uploads.length ? `${uploads.length} image${uploads.length === 1 ? "" : "s"} attached below` : "",
      uploads,
    };
  });
  const complete = items.filter((item) => item.status === "Complete").length;
  const sourceFiles = (payload.sourceFiles || []).join(", ") || "Manual checklist";
  const dashboardUrl = payload.dashboardUrl || "";
  const content = [
    paragraph(`Test checklist submitted for ${payload.issueKey}.`),
    paragraph(`Progress: ${complete} of ${items.length} complete.`),
    paragraph(`Source: ${sourceFiles}.`),
  ];

  if (dashboardUrl) {
    content.push(paragraph(`Dashboard: ${dashboardUrl}`));
  }

  content.push({
    type: "table",
    attrs: {
      isNumberColumnEnabled: false,
      layout: "wide",
    },
    content: [
      tableRow(["#", "Status", "Test case", "Notes", "Images"], true),
      ...items.map((item) => tableRow([item.number, item.status, item.title, item.notes, item.imageSummary])),
    ],
  });

  items.forEach((item) => {
    const inlineUploads = item.uploads.filter((upload) => upload.mediaId);
    const fallbackUploads = item.uploads.filter((upload) => !upload.mediaId);

    if (!item.uploads.length) {
      return;
    }

    content.push(paragraph(`Images for #${item.number}: ${item.title}`));
    inlineUploads.forEach((upload) => {
      content.push(mediaSingle(upload));
    });
    fallbackUploads.forEach((upload) => {
      content.push(paragraph(`Attached image: ${upload.filename}`));
    });
  });

  return {
    type: "doc",
    version: 1,
    content,
  };
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) {
    throw new Error("Unsupported checklist image data.");
  }

  return {
    mimeType: match[1].toLowerCase().replace("image/jpg", "image/jpeg"),
    buffer: Buffer.from(match[2].replace(/\s+/g, ""), "base64"),
  };
}

async function uploadChecklistImage(issueKey, image, itemIndex, imageIndex) {
  const parsed = parseDataUrl(image.dataUrl);
  const filename = safeFilename(image.name, `checklist-${itemIndex + 1}-${imageIndex + 1}.jpg`);
  const form = new FormData();
  form.append("file", new Blob([parsed.buffer], { type: parsed.mimeType }), filename);

  const response = await fetch(`${siteUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      "X-Atlassian-Token": "no-check",
    },
    body: form,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Jira attachment upload failed: HTTP ${response.status} ${response.statusText}\n${text}`);
  }

  const uploaded = text ? JSON.parse(text) : [];
  const attachment = Array.isArray(uploaded) ? uploaded[0] : uploaded;

  return {
    id: String(attachment?.id || ""),
    filename: attachment?.filename || filename,
    mediaId: "",
    width: image.width || 800,
    height: image.height || 600,
    itemIndex,
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMediaIdForAttachment(html, attachmentId) {
  const id = escapeRegex(attachmentId);
  const patterns = [
    new RegExp(`"attachmentId":"${id}"\\s*,\\s*"attachmentMediaApiId":"([0-9a-f-]{36})"`, "i"),
    new RegExp(`"attachmentMediaApiId":"([0-9a-f-]{36})"\\s*,\\s*"attachmentId":"${id}"`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return match[1];
    }
  }

  const index = html.indexOf(attachmentId);
  if (index === -1) {
    return "";
  }

  const windowText = html.slice(Math.max(0, index - 4000), index + 4000);
  const mediaMatch = windowText.match(/attachmentMediaApiId":"([0-9a-f-]{36})"/i) ||
    windowText.match(/data-media-services-id="([0-9a-f-]{36})"/i) ||
    windowText.match(/card-uuid="([0-9a-f-]{36})"/i);
  return mediaMatch ? mediaMatch[1] : "";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hydrateMediaIds(issueKey, uploads) {
  const pending = uploads.filter((upload) => upload.id && !upload.mediaId);
  if (!pending.length) {
    return uploads;
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const html = await jiraSiteFetch(`/browse/${encodeURIComponent(issueKey)}`);
    pending.forEach((upload) => {
      if (!upload.mediaId) {
        upload.mediaId = findMediaIdForAttachment(html, upload.id);
      }
    });

    if (pending.every((upload) => upload.mediaId)) {
      break;
    }

    await delay(1000);
  }

  return uploads;
}

async function uploadChecklistImages(payload) {
  const uploadsByItem = new Map();
  const uploads = [];

  for (let itemIndex = 0; itemIndex < payload.items.length; itemIndex += 1) {
    const images = payload.items[itemIndex].images || [];
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const upload = await uploadChecklistImage(payload.issueKey, images[imageIndex], itemIndex, imageIndex);
      uploads.push(upload);
      if (!uploadsByItem.has(itemIndex)) {
        uploadsByItem.set(itemIndex, []);
      }
      uploadsByItem.get(itemIndex).push(upload);
    }
  }

  await hydrateMediaIds(payload.issueKey, uploads);
  return uploadsByItem;
}

async function postComment(issueKey, body) {
  return jiraApiFetch(`/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

async function postChecklistComment(rawPayload) {
  const payload = sanitizeChecklistPayload(rawPayload);
  const uploadsByItem = hasChecklistImages(payload) ? await uploadChecklistImages(payload) : new Map();
  const comment = await postComment(payload.issueKey, buildCommentBody(payload, uploadsByItem));

  return {
    issueKey: payload.issueKey,
    comment,
    itemCount: payload.items.length,
    completeCount: payload.items.filter((item) => item.done).length,
    imageCount: Array.from(uploadsByItem.values()).reduce((total, uploads) => total + uploads.length, 0),
  };
}

module.exports = {
  siteUrl,
  sanitizeChecklistPayload,
  hasChecklistImages,
  buildCommentBody,
  postChecklistComment,
};
