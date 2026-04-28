import type { WeaponKind } from '@shared/types'

// Sprite sheet: 1376×768, 3 cols × 2 rows = 459×384 per cell
// Grid positions (col, row): bazooka(0,0) grenade(1,0) shotgun(2,0) [skip](0,1) teleport(1,1) dynamite(2,1)
const SPRITE_COLS = 3
const SPRITE_CELL_W = 100 / SPRITE_COLS   // percentage
const SPRITE_CELL_H = 50                   // percentage (2 rows)

const WEAPONS: { weapon: WeaponKind; label: string; sub: string; color: string; spriteCol: number; spriteRow: number }[] = [
  { weapon: 'bazooka',   label: 'BAZOOKA',   sub: '45 DMG',   color: '#ff8844', spriteCol: 0, spriteRow: 0 },
  { weapon: 'grenade',   label: 'GRENADE',   sub: '40 DMG',   color: '#88cc44', spriteCol: 1, spriteRow: 0 },
  { weapon: 'shotgun',   label: 'SHOTGUN',   sub: '2×30 DMG', color: '#ffcc44', spriteCol: 2, spriteRow: 0 },
  { weapon: 'teleport',  label: 'TELEPORT',  sub: 'RELOCATE', color: '#aa44ff', spriteCol: 1, spriteRow: 1 },
  { weapon: 'dynamite',  label: 'DYNAMITE',  sub: '70 DMG',   color: '#ff4444', spriteCol: 2, spriteRow: 1 },
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
            <div class="wp-card-icon" style="background-image:url('/weapons-sprites.png');background-size:${SPRITE_COLS * 100}% 200%;background-position:${w.spriteCol * SPRITE_CELL_W}% ${w.spriteRow * SPRITE_CELL_H * 2}%"></div>
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

export function getWeaponSpriteStyle(weapon: WeaponKind): string {
  const w = WEAPONS.find(w => w.weapon === weapon)
  if (!w) return ''
  return `background-image:url('/weapons-sprites.png');background-size:${SPRITE_COLS * 100}% 200%;background-position:${w.spriteCol * SPRITE_CELL_W}% ${w.spriteRow * SPRITE_CELL_H * 2}%`
}
