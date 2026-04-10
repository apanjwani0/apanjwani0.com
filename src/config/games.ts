export interface Game {
  slug: string
  title: string
  description: string
  enabled: boolean
}

export const games: Game[] = [
  {
    "slug": "flash-cricket",
    "title": "Flash Cricket",
    "description": "A 2D browser cricket game — swing your bat and hit the ball into scoring zones.",
    "enabled": true
  }
]
