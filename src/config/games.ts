export interface Game {
  slug: string
  title: string
  description: string
  enabled: boolean
  keywords?: string
}

export const games: Game[] = [
  {
    "slug": "flash-cricket",
    "title": "Flash Cricket",
    "description": "A 2D browser cricket game — swing your bat and hit the ball into scoring zones. \n\nBuilding this as a hobby, I used to play this type of miniclip game when I was a kid. Can't find this anymore, so why not... building in c++",
    "enabled": true,
    "keywords": "cricket,miniclip,flash-game, flash-cricket"
  }
]
