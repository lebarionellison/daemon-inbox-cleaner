const TRIAGE_RULES = {
  urgent: {
    priority: 1,
    label: "Urgent",
    action: "Respond immediately"
  },
  action_required: {
    priority: 2,
    label: "Action Required",
    action: "Review and respond"
  },
  fyi: {
    priority: 3,
    label: "FYI",
    action: "Read when convenient"
  },
  newsletter: {
    priority: 4,
    label: "Newsletter",
    action: "Review or unsubscribe"
  },
  spam: {
    priority: 5,
    label: "Spam",
    action: "Ignore or delete"
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}

function triageEmail(email) {
  const subject = String(email.subject || "").toLowerCase();
  const body = String(email.body || "").toLowerCase();
  const sender = String(email.sender || "").toLowerCase();

  const text = `${subject}\n${body}`;

  if (
    /\b(urgent|immediately|asap|critical|security alert|account compromised)\b/.test(text)
  ) {
    return {
      category: "urgent",
      confidence: 0.95,
      reason: "Urgency or critical-account language detected."
    };
  }

  if (
    /\b(action required|please respond|please review|deadline|due date|approval required|sign|confirm)\b/.test(text)
  ) {
    return {
      category: "action_required",
      confidence: 0.9,
      reason:
        "The message appears to require a response, review, approval, or confirmation."
    };
  }

  if (
    /\b(unsubscribe|newsletter|weekly digest|monthly update|marketing|promotion|special offer)\b/.test(
      text
    )
  ) {
    return {
      category: "newsletter",
      confidence: 0.9,
      reason: "Newsletter or marketing language detected."
    };
  }

  if (
    /\b(viagra|casino|lottery winner|claim your prize|crypto investment opportunity)\b/.test(
      text
    ) ||
    /\b(no-reply|noreply)@/.test(sender)
  ) {
    return {
      category: "spam",
      confidence: 0.75,
      reason: "Potentially unwanted or promotional sender/content detected."
    };
  }

  return {
    category: "fyi",
    confidence: 0.7,
    reason:
      "No urgent, action-required, newsletter, or spam indicators detected."
  };
}

function getGoogleOAuthUrl(env, state) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: "https://daemon-inbox-cleaner.lebarionellison.workers.dev/oauth/callback",
    response_type: "code",
    scope:
      "openid email profile https://www.googleapis.com/auth/gmail.readonly",
    access_type: "offline",
    prompt: "consent",
    state
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function randomState() {
  return crypto.randomUUID();
}

async function exchangeCodeForTokens(code, env) {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri:
      "https://daemon-inbox-cleaner.lebarionellison.workers.dev/oauth/callback",
    grant_type: "authorization_code"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  return response;
}

async function getGoogleProfile(accessToken) {
  const response = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function getGmailMessages(accessToken, maxResults = 10) {
  const listUrl = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages"
  );

  listUrl.searchParams.set("maxResults", String(maxResults));
  listUrl.searchParams.set("labelIds", "INBOX");

  const listResponse = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!listResponse.ok) {
    throw new Error("Unable to read Gmail messages.");
  }

  const listData = await listResponse.json();

  const messages = [];

  for (const item of listData.messages || []) {
    const messageResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (!messageResponse.ok) {
      continue;
    }

    const message = await messageResponse.json();

    const headers = message.payload?.headers || [];

    const from =
      headers.find(
        (header) => header.name.toLowerCase() === "from"
      )?.value || "";

    const subject =
      headers.find(
        (header) => header.name.toLowerCase() === "subject"
      )?.value || "";

    const date =
      headers.find(
        (header) => header.name.toLowerCase() === "date"
      )?.value || "";

    const triage = triageEmail({
      sender: from,
      subject,
      body: ""
    });

    messages.push({
      id: message.id,
      threadId: message.threadId,
      sender: from,
      subject,
      date,
      triage: {
        category: TRIAGE_RULES[triage.category].label,
        priority: TRIAGE_RULES[triage.category].priority,
        action: TRIAGE_RULES[triage.category].action,
        confidence: triage.confidence,
        reason: triage.reason
      }
    });
  }

  return messages;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        service: "Daemon Inbox Cleaner",
        status: "online",
        version: "0.2.0",
        capabilities: [
          "Gmail OAuth",
          "Gmail read-only access",
          "Email triage"
        ]
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        status: "healthy",
        service: "daemon-inbox-cleaner"
      });
    }

    if (request.method === "GET" && url.pathname === "/oauth/start") {
      const state = randomState();

      const oauthUrl = getGoogleOAuthUrl(env, state);

      return Response.redirect(oauthUrl, 302);
    }

    if (request.method === "GET" && url.pathname === "/oauth/callback") {
      const error = url.searchParams.get("error");

      if (error) {
        return html(
          `<h1>Daemon Inbox Cleaner</h1><p>Google authorization was not completed.</p><p>Error: ${error}</p>`,
          400
        );
      }

      const code = url.searchParams.get("code");

      if (!code) {
        return html(
          "<h1>Daemon Inbox Cleaner</h1><p>Missing Google authorization code.</p>",
          400
        );
      }

      try {
        const tokenResponse = await exchangeCodeForTokens(code, env);

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
          return json(
            {
              error: "Google OAuth token exchange failed.",
              details: tokenData
            },
            400
          );
        }

        const profile = await getGoogleProfile(tokenData.access_token);

        return json({
          service: "Daemon Inbox Cleaner",
          status: "google_connected",
          message:
            "Google authorization succeeded. Gmail read-only access is available.",
          account: profile?.email || "Google account authorized",
          has_refresh_token: Boolean(tokenData.refresh_token),
          next_step:
            "Use the access token with the Gmail API to retrieve messages."
        });
      } catch (error) {
        return json(
          {
            error: "OAuth callback failed.",
            details: String(error?.message || error)
          },
          500
        );
      }
    }

    if (request.method === "POST" && url.pathname === "/triage") {
      try {
        const email = await request.json();

        if (!email || typeof email !== "object") {
          return json(
            { error: "Request body must be a JSON object." },
            400
          );
        }

        const result = triageEmail(email);
        const rule = TRIAGE_RULES[result.category];

        return json({
          input: {
            sender: email.sender || "",
            subject: email.subject || ""
          },
          triage: {
            category: rule.label,
            priority: rule.priority,
            action: rule.action,
            confidence: result.confidence,
            reason: result.reason
          }
        });
      } catch {
        return json(
          { error: "Invalid JSON request body." },
          400
        );
      }
    }

    if (request.method === "GET" && url.pathname === "/gmail/messages") {
      const authorization =
        request.headers.get("Authorization") || "";

      if (!authorization.startsWith("Bearer ")) {
        return json(
          {
            error:
              "Authorization required. Supply a Google OAuth access token as a Bearer token."
          },
          401
        );
      }

      const accessToken = authorization.substring("Bearer ".length);

      try {
        const messages = await getGmailMessages(accessToken, 10);

        return json({
          service: "Daemon Inbox Cleaner",
          count: messages.length,
          messages
        });
      } catch (error) {
        return json(
          {
            error: "Gmail message retrieval failed.",
            details: String(error?.message || error)
          },
          502
        );
      }
    }

    return json(
      {
        error: "Not found",
        endpoints: [
          "/",
          "/health",
          "/oauth/start",
          "/oauth/callback",
          "/triage",
          "/gmail/messages"
        ]
      },
      404
    );
  }
};