const appJson = require('./app.json');

module.exports = () => {
  const expo = appJson.expo ?? {};
  const webBaseUrl = String(
    process.env.EXPO_PUBLIC_WEB_BASE_URL ?? ''
  ).trim();

  const experiments = {
    ...(expo.experiments ?? {}),
  };

  if (webBaseUrl) {
    experiments.baseUrl = webBaseUrl;
  } else {
    delete experiments.baseUrl;
  }

  return {
    ...expo,
    web: {
      ...(expo.web ?? {}),
      bundler: 'metro',
      output: 'single',
    },
    experiments,
  };
};
