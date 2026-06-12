exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    const { pin } = JSON.parse(event.body || "{}");

    if (!pin || pin !== process.env.DASHBOARD_PIN) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Invalid PIN" })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, token: process.env.DASHBOARD_API_SECRET || '' })
    };
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Bad request" })
    };
  }
};
