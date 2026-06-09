import './globals.css'

export const metadata = {
  title: 'Sosimple Energy Portal',
  description: 'Solar performance monitoring for Sosimple Energy',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
