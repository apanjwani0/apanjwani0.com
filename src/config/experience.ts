export interface Role {
  title: string
  team?: string
  period: string
  bullets: string[]
}

export interface Company {
  name: string
  roles: Role[]
}

export const experience: Company[] = [
  {
    "name": "Chalo Mobility",
    "roles": [
      {
        "title": "SDE 2",
        "team": "Payments",
        "period": "Sept 2024 – Present",
        "bullets": [
          "Designed and scaled payment infrastructure processing 100k+ daily transactions across Digital Wallets and Prepaid Cards (₹2.5M+ daily volume)",
          "Implemented idempotency mechanisms for zero duplicate transactions and strong financial data consistency",
          "Led Partner Bank API migration complying with RBI regulations for Prepaid Payment Instruments (PPI)",
          "Re-architected refund workflows and transaction reconciliation logic, reducing customer support incidents by 75%"
        ]
      },
      {
        "title": "Software Engineer",
        "team": "Recon & Operator App",
        "period": "Jul 2022 – Aug 2024",
        "bullets": [
          "Architected a queue-based data processing pipeline for improved system stability",
          "Led technical onboarding of 20+ city teams; streamlined reporting and contract management for 100+ operators",
          "Engineered settlement reconciliation and automated ledger system for operator financial tracking",
          "Redesigned APIs and optimized DB queries — reduced response times by 70%"
        ]
      },
      {
        "title": "Intern",
        "team": "Recon",
        "period": "Jan 2022 – Jun 2022",
        "bullets": [
          "Migrated backend services from legacy systems to Node.js, improving API performance by 40%",
          "Identified and resolved critical code vulnerabilities, decreasing bug reports by 25%"
        ]
      }
    ]
  },
  {
    "name": "Listnr, Inc.",
    "roles": [
      {
        "title": "Intern",
        "team": "Backend",
        "period": "May 2021 – Aug 2021",
        "bullets": [
          "Led backend development for core product engineering",
          "Designed scalable architectural features from the ground up"
        ]
      }
    ]
  },
  {
    "name": "Code Partner IT Solutions",
    "roles": [
      {
        "title": "Intern",
        "team": "Backend",
        "period": "Nov 2020 – Dec 2020",
        "bullets": [
          "Backend development for multiple client projects",
          "Integrated React-based frontends with custom API backends"
        ]
      }
    ]
  }
]
