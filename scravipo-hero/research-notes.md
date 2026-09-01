# Verified Public Data Research Notes

## Sources opened

OpenAI official design guidelines: https://openai.com/brand/ . The page states that OpenAI logos are trademarks, provides prescribed usage guidance, and exposes official public contact links such as legal@openai.com and partnercomms@openai.com. Use official brand assets only with appropriate marks guidance; otherwise prefer a neutral initials fallback.

Stripe official newsroom asset page: https://stripe.com/newsroom/information . The page states that official Stripe logos, badges, screenshots, and photos are available and links to a downloadable logo kit and Marks Usage Agreement. For the demo UI, use stripe.com as the official website and a neutral text/initials treatment unless an approved logo file is added.

## Safe implementation decisions

Use official organization websites and organization-level contact routes only. Do not add personal phone numbers or personal email addresses for real people unless the user supplies them and they are explicitly intended for public display. For people, use verified/public professional photos only when an authoritative source is available; otherwise keep initials. Mask phone and personal email fields. For venture-capital firms without an explicitly published public email, show the official contact page URL rather than inventing an address.

## Data scope for this refinement

Update company, VC, and local-business rows with official domains and public organization contact pages where available. Add organization emails only when directly published by the organization. Add investor/person phone and email columns with privacy-safe official or masked values rather than fabricating private contacts. Use logo URLs or uploaded official assets only when their source and display rights are clear.

## References

[1]: https://openai.com/brand/ — OpenAI Design Guidelines.
[2]: https://stripe.com/newsroom/information — Stripe Newsroom: Information and assets.

## Additional official sources opened

Accel official contact page: https://www.accel.com/contact-us . Public organization details include Palo Alto at 500 University Avenue, San Francisco at 35 South Park Street, and office phones +1 650 614 4800 and +1 415 293 1100. The page exposes a Download Logo as SVG control and the official LinkedIn profile https://www.linkedin.com/company/accel-vc/ . No general email was published in the extracted contact section, so use the official contact URL rather than inventing an email.

Index Ventures official website: https://www.indexventures.com/ . The official site exposes its contact path at https://www.indexventures.com/contact-us/ and its LinkedIn company profile at https://www.linkedin.com/company/index-ventures . Use its official website and contact path; do not infer a general email address.

## Public profile source opened

Sequoia Capital official site: https://sequoiacap.com/ . The official site identifies Sequoia Capital and exposes official founder/team/company pages. It is suitable as the investor/VC organization URL; do not infer a general email address from the site.

Airbnb Newsroom leadership page: https://news.airbnb.com/about-us/leadership/brian-chesky/ . The official page identifies Brian Chesky as Airbnb co-founder and CEO and provides an authoritative headshot URL: https://news.airbnb.com/wp-content/uploads/sites/4/2016/10/Brian-Chesky-Headshot-IR-Crop-Airbnb-2.jpg?w=624 . This image may be used as a remote public professional profile image if the product intends to display it, while personal phone/email fields remain masked.

## Additional public profile sources opened

NVIDIA Newsroom executive bio: https://nvidianews.nvidia.com/bios/jensen-huang . The page identifies Jensen Huang as NVIDIA Founder & CEO and exposes an official headshot URL: https://iprsoftwaremedia.com/219/files/202604/f0e9efa72f909f3f08cdd0a48ff92880/69e6b9293d633260eec67804_jensen-1920x1920/jensen-1920x1920_6a7e6ad5-c215-4503-b70d-fe6e5e9de205-prv.jpg?v=6a7e6ad5-c215-4503-b70d-fe6e5e9de205 . NVIDIA also exposes a press contacts route at https://nvidianews.nvidia.com/contacts .

Dario Amodei’s official site: https://darioamodei.com/ . The page identifies Dario Amodei as CEO of Anthropic and links to Anthropic. No headshot or personal contact address was exposed on the page, so use an official Anthropic source or a safe neutral fallback rather than inventing one.

## Investment-size and profile findings

First Round official homepage: https://www.firstround.com/ . The official site states that its average initial investment is $3.5 million, with investments in rounds as small as $100,000 and as large as $20 million. This supports a numeric dashboard check-size display of "$100K–$20M" and average "$3.5M" for the First Round record.

Canva Newsroom Melanie Perkins page: https://www.canva.com/newsroom/news/author/melanie-perkins/ . The official page identifies Melanie Perkins as Co-Founder and CEO of Canva and exposes her public LinkedIn profile https://www.linkedin.com/in/melanieperkins/ . The page’s profile image was not rendered as a usable headshot, so do not fabricate one.

## Investor profile and public contact sources opened

Alfred Lin official Sequoia profile: https://sequoiacap.com/people/alfred-lin . The page identifies Alfred Lin as a Sequoia seed/early partner and publicly exposes the professional organization email mailto:Early-AL@sequoiacap.com through its “Get in touch with Alfred” link. Use the firm profile image only if extracted as a direct official asset; otherwise use an organization mark.

Aileen Lee official Cowboy Ventures profile: https://www.cowboy.vc/team/aileen-lee . The page identifies Aileen Lee as Founder & Managing Partner and publishes the firm contact channels hello@cowboy.vc and inquiries@cowboy.vc, plus the Palo Alto office address. Use hello@cowboy.vc as the organization-level public email for the record; do not add a personal phone number.

## Profile image sources extracted from official pages

Cowboy Ventures official Aileen Lee profile image: https://cdn.prod.website-files.com/637b82f903cd694c0b0f7546/63ce452d8de9f286395dac25_Aileen_profile_pic.webp . This is the image rendered on https://www.cowboy.vc/team/aileen-lee .

Sequoia official Alfred Lin profile image: https://framerusercontent.com/images/qN8j54q8Vi2GA6Fqt0OG8fQSJw.webp?width=880&height=880 . This is the image rendered on https://sequoiacap.com/people/alfred-lin . The same page publicly links mailto:Early-AL@sequoiacap.com .

## Organization-level contact sources opened

Anthropic official newsroom: https://www.anthropic.com/news . The page publicly publishes press@anthropic.com for press inquiries. Use that address as a privacy-safe organization-level contact for the Dario Amodei record, not as a personal email.

Canva official newsroom and press center: https://www.canva.com/newsroom/news/ . The page publishes comms@canva.com for general press inquiries and media requests. Use that organization-level contact for the Melanie Perkins record.

## Public phone/email verification

NVIDIA official Americas contact page: https://www.nvidia.com/en-us/contact/ . It publishes the corporate phone +1 (408) 486-2000 and info@nvidia.com for NVIDIA Corporate at 2788 San Tomas Expressway, Santa Clara, CA 95051.

Airbnb official newsroom contact page: https://news.airbnb.com/contact/ . It publishes contact.press@airbnb.com for general press inquiries. The user-facing Airbnb Help Center has a public customer-service phone, but it is not a personal contact for Brian Chesky, so keep Brian’s phone field as an official newsroom/contact route rather than misrepresenting a company support line as his personal number.

## Local business public contacts opened

Blue Bottle Coffee official support page: https://support.bluebottlecoffee.com/hc/en-us/requests/new . It publishes support@bluebottlecoffee.com for guest experience, press@bluebottlecoffee.com for press inquiries, and a public support workflow. The official website is https://bluebottlecoffee.com/us/eng .

Monocle official shops and cafés page: https://monocle.com/monocle-shops-and-cafes/ . The Monocle Café London listing publishes +44 20 7135 2040 and ma@monocle.com at 18 Chiltern Street, London W1U 7QA. The official website is https://monocle.com/ .

## Additional local business source

Borough Market official contact page: https://boroughmarket.org.uk/contact-us/ . It publishes the organization phone 020 7407 1002 and general enquiries contact at info@boroughmarket.org.uk (the site masks the email in extracted HTML but the public result identifies it). The official website is https://boroughmarket.org.uk/ .

## Investor firm phone source

Accel official contact page: https://www.accel.com/contact-us . It publishes Palo Alto +1 650 614 4800 and San Francisco +1 415 293 1100. Use the Palo Alto office line for the Accel investor record. The page also exposes an official logo download action and firm social links.

## Additional public profile source

First Round official Josh Kopelman profile: https://www.firstround.com/team/investing/josh-kopelman . The page identifies Josh Kopelman as Partner and renders the official headshot at https://cdn.sanity.io/images/m6i10uln/production/eb12eb2d830fd3e3b118a6c326d0d1692003c4d4-1024x1256.png?fm=webp&w=3840&q=80 .

## VC contact sources opened

Index Ventures official contact page: https://www.indexventures.com/contact-us/ . It publishes public office phones including +1 415 471 1700 (San Francisco), +44 20 7154 2020 (London), and the public media email press@indexventures.com.

General Catalyst official contact page: https://www.generalcatalyst.com/contact . It publishes office lines including +1 415-659-5000 (San Francisco), +1 212-775-4000 (New York), and +1 617-234-7000 (Cambridge). Use the San Francisco office line and an official contact page link rather than inventing a direct email if none is publicly listed.

## Visual verification findings

Desktop full-page preview at 1440×1600 confirms the hero remains intact, the dashboard renders with the brighter translucent glass panel, company/person/org marks occupy identity cells, the four-card How It Works grid remains in place, and the footer follows without the previous oversized gap. Mobile full-page preview at 390×1800 confirms the lead table remains contained in its horizontal scroller, the bento cards stack without page-width bleed, and the footer retains contact/social content and the sculptural mark. The active Investor view visibly shows headshots/marks and populated rows; other categories use the same data model and responsive renderer.
