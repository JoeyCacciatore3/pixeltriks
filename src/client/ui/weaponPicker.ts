import type { WeaponKind } from '@shared/types'

const WEAPONS: { weapon: WeaponKind; label: string; sub: string; color: string }[] = [
  { weapon: 'bazooka',   label: 'BAZOOKA',   sub: '45 DMG',   color: '#ff8844' },
  { weapon: 'grenade',   label: 'GRENADE',   sub: '40 DMG',   color: '#88cc44' },
  { weapon: 'shotgun',   label: 'SHOTGUN',   sub: '2×30 DMG', color: '#ffcc44' },
  { weapon: 'airstrike', label: 'AIRSTRIKE', sub: '5×55 DMG', color: '#4488ff' },
  { weapon: 'teleport',  label: 'TELEPORT',  sub: 'RELOCATE', color: '#aa44ff' },
  { weapon: 'dynamite',  label: 'DYNAMITE',  sub: '70 DMG',   color: '#ff4444' },
]

export class WeaponPicker {
  private el: HTMLElement
  private onSelect: ((weapon: WeaponKind) => void) | null = null
  private visible = false

  constructor() {
    this.el = document.createElement('div')
    this.el.className = 'weapon-picker'
    this.el.innerHTML = `
      <div class="wp-label">SELECT WEAPON</div>
      <div class="wp-cards">
        ${WEAPONS.map((w, i) => `
          <button class="wp-card" data-weapon="${w.weapon}" data-color="${w.color}">
            <div class="wp-card-num">${i + 1}</div>
            <div class="wp-card-name">${w.label}</div>
            <div class="wp-card-sub">${w.sub}</div>
          </button>
        `).join('')}
      </div>
    `
    document.body.appendChild(this.el)

    this.el.querySelectorAll('.wp-card').forEach(btn => {
      const confirm = (e: Event) => {
        e.preventDefault()
        this.select((btn as HTMLElement).dataset.weapon as WeaponKind)
      }
      btn.addEventListener('click', confirm)
      btn.addEventListener('touchend', confirm, { passive: false })
    })

    window.addEventListener('keydown', this.onKeyDown)
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.visible) return
    const idx = parseInt(e.key) - 1
    if (idx >= 0 && idx < WEAPONS.length) {
      e.preventDefault()
      this.select(WEAPONS[idx].weapon)
    }
    if (e.code === 'Escape') this.hide()
  }

  private select(weapon: WeaponKind): void {
    this.hide()
    this.onSelect?.(weapon)
  }

  show(current: WeaponKind, onSelect: (weapon: WeaponKind) => void): void {
    this.onSelect = onSelect
    this.visible = true
    this.el.classList.add('wp-open')

    this.el.querySelectorAll<HTMLElement>('.wp-card').forEach(btn => {
      const color = btn.dataset.color!
      const isActive = btn.dataset.weapon === current
      btn.style.borderColor = isActive ? color : 'rgba(255,255,255,0.14)'
      btn.style.boxShadow = isActive
        ? `0 4px 20px rgba(0,0,0,0.5), 0 0 20px ${color}55, 0 1px 0 rgba(255,255,255,0.12) inset`
        : '0 4px 20px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.08) inset'
      btn.style.transform = isActive ? 'translateY(-3px)' : ''
    })
  }

  hide(): void {
    this.visible = false
    this.el.classList.remove('wp-open')
  }

  isOpen(): boolean {
    return this.visible
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    this.el.remove()
  }
}
