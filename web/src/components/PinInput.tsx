import { useState } from 'react'

/** Saisie d'un PIN à 6 chiffres : un vrai champ (clavier numérique, collage) habillé de 6 cases. */
export function PinInput({ id, value, onChange, label, invalid = false, autoFocus = false }: {
  id: string; value: string; onChange: (v: string) => void; label: string; invalid?: boolean; autoFocus?: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label htmlFor={id} className="sr-only">{label}</label>
      <div className="group relative">
        <input
          id={id} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          type={show ? 'text' : 'password'} inputMode="numeric" pattern="[0-9]*" maxLength={6} autoFocus={autoFocus}
          autoComplete="off" aria-invalid={invalid} className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
        />
        <div className="flex justify-center gap-2" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className={`flex h-14 w-11 items-center justify-center rounded-xl border-2 bg-card text-2xl font-extrabold transition sm:w-12 ${invalid ? 'border-bad' : i === value.length ? 'border-line group-focus-within:border-brand' : value[i] ? 'border-ink/40' : 'border-line'}`}>
              {value[i] ? (show ? value[i] : '•') : ''}
            </span>
          ))}
        </div>
      </div>
      <button type="button" onClick={() => setShow(!show)} className="mx-auto mt-4 block text-sm font-semibold text-ink-soft underline">{show ? 'Masquer le PIN' : 'Afficher le PIN'}</button>
    </div>
  )
}
