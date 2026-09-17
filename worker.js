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
      reason: "The message appears to require a response, review, approval, or confirmation."
    };
  }

  if (
    /\b(unsubscribe|newsletter|weekly digest|monthly update|marketing|promotion|special offer)\b/.test(text)
  ) {
    return {
      category: "newsletter",
      confidence: 0.9,
      reason: "Newsletter or marketing language detected."
    };
  }

  if (
    /\b(viagra|casino|lottery winner|claim your prize|crypto investment opportunity)\b/.test(text) ||
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
    reason: "No urgent, action-required, newsletter, or spam indicators detected."
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        service: "Daemon Inbox Cleaner",
        status: "online",
        version: "0.1.0"
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        status: "healthy",
        service: "daemon-inbox-cleaner"
      });
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

    return json(
      {
        error: "Not found",
        endpoints: ["/", "/health", "/triage"]
      },
      404
    );
  }
};