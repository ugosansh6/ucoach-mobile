import React from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#07090C" />
        <meta name="color-scheme" content="dark light" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="UGEROD" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="description"
          content="UGEROD, ton coach sportif personnel adaptatif."
        />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/ugerod-icon.png" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
