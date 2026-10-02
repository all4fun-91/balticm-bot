import './globals.css';

export const metadata = {
  title: 'BalticM AI',
  description: 'BalticM AI engineering assistant',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
