export interface Post {
  title: string
  href: string
  date: string
  summary: string
  content?: string
  keywords?: string
}

export const posts: Post[] = [
  {
    "title": "First Draft",
    "href": "/blogs/first-draft",
    "date": "2026-03-29",
    "summary": "The day this portfolio went live",
    "content": "...... soon to be added"
  },
  {
    "title": "Visit to Jawaharlal Nehru Planetarium Bengaluru",
    "href": "blogs/nehru-planetarium-bengaluru",
    "date": "2026-04-05",
    "summary": "Sunday Trip Review",
    "content": "I visited [Jawaharlal Nehru Planetarium](https://share.google/lWRtv6TfByUF7gOu4) for a sky theatre show called : 'Celestial Fireworks'. \nIt was a 40 Min, high-resolution digital show that explores the dramatic, explosive life cycles of stars, including stellar explosions, black holes, and the Big Bang. I really enjoyed the experience, and would 100% recommend it to everyone. The show was in English and there were no subtitles. 50% of the tickets are reserved for On spot Booking, booking window opens 30 mins prior to the show timings.",
    "keywords": "Jawaharlal Nehru Planetarium, Celestial Fireworks,"
  }
]
