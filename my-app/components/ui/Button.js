export default function Button({ children, onClick, type = 'button', variant = 'primary' }) {
  return (
    <button type={type} onClick={onClick} className={`btn btn-${variant}`}>
      {children}
    </button>
  )
}
