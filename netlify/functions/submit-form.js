export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { recaptchaToken, formData } = JSON.parse(event.body);

    console.log('Received form data:', formData);

    // Verify reCAPTCHA
    const recaptchaResponse = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${recaptchaToken}`
    });

    const recaptchaData = await recaptchaResponse.json();
    console.log('reCAPTCHA result:', recaptchaData);

    // Check if reCAPTCHA validation passed
    if (!recaptchaData.success || recaptchaData.score < 0.5) {
      console.error('reCAPTCHA failed:', recaptchaData);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'reCAPTCHA validation failed', details: recaptchaData })
      };
    }

    // Submit to HubSpot
    const formId = formData.formId || process.env.HUBSPOT_FORM_ID;
    const hubspotUrl = `https://api.hsforms.com/submissions/v3/integration/submit/${process.env.HUBSPOT_PORTAL_ID}/${formId}`;
    console.log('Submitting to HubSpot:', hubspotUrl);
    console.log('Form data being sent:', JSON.stringify(formData));

    const hubspotResponse = await fetch(hubspotUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    const hubspotData = await hubspotResponse.json();
    console.log('HubSpot response:', hubspotData);

    if (!hubspotResponse.ok) {
      console.error('HubSpot error:', hubspotData);
      return {
        statusCode: hubspotResponse.status,
        body: JSON.stringify({ error: 'HubSpot submission failed', details: hubspotData })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(hubspotData)
    };
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
}
