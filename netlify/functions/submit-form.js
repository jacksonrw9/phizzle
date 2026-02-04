export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { recaptchaToken, formData } = JSON.parse(event.body);

    console.log('Received form data:', formData);

    // Verify reCAPTCHA Enterprise
    const recaptchaResponse = await fetch(
      `https://recaptchaenterprise.googleapis.com/v1/projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/assessments?key=${process.env.GOOGLE_CLOUD_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: {
            token: recaptchaToken,
            siteKey: '6Le6W1osAAAAAEySdjeFfrJffcwvyfL2ph1Dsxyf',
            expectedAction: 'submit'
          }
        })
      }
    );

    const recaptchaData = await recaptchaResponse.json();
    console.log('reCAPTCHA Enterprise result:', recaptchaData);

    // Enterprise returns score in a different structure than standard v3
    const score = recaptchaData.riskAnalysis?.score || 0;
    const valid = recaptchaData.tokenProperties?.valid || false;

    // Check if reCAPTCHA validation passed
    if (!valid || score < 0.5) {
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
