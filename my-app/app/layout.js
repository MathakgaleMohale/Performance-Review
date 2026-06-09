import './globals.css'
import Script from 'next/script'

export const metadata = {
  title: 'Sosimple Energy Portal',
  description: 'Solar performance monitoring for Sosimple Energy',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css" />
      </head>
      <body>
        <Script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  )
}
