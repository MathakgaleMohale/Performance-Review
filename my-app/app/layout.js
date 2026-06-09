import './globals.css'

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
      <body>{children}</body>
    </html>
  )
}
