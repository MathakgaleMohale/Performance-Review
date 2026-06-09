import './globals.css'

export const metadata = {
  title: 'My App',
  description: 'Built with Next.js',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
