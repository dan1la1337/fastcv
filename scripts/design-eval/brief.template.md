# Design review: FastCV

You are a senior product designer. Review the products in this pack from their screenshots. This is a read-only review. Do not edit files, start servers, or open browsers. Read each image before you score.

FastCV is a Russian job board. Candidates find vacancies and apply with an AI cover letter. Employers review applications. This pack holds two builds of FastCV and other job boards for comparison.

## What is in the pack

Image paths are relative to the folder that holds this brief. Each image carries its own path in a strip at the top. Each image is a sheet of labelled tiles. A desktop tile is a 1440×900 viewport. A mobile tile is a 412×915 viewport. Sheets are scaled to fit, so judge small text with care and do not treat scaling softness as a defect.

The data is test data. Do not score its wording. Score how the UI lays it out, for example how it truncates a long title. Live counters are hidden on every FastCV screenshot, so the home page shows an empty area where the counter block sits. Do not score that area. A candidate who opens `/resumes` is sent to the feed, so the tile `candidate-resumes` repeats the feed. The screens of the other job boards show public pages of a logged-out visitor. A grey bar on a screenshot hides a personal name. Ignore it.

Products:

{{PRODUCTS}}

Tiles of each FastCV build:

{{SCREENS}}

Tiles of each other job board:

{{REFERENCES}}

Tasks, in the order a user does them. Each step is a tile named above:

{{FLOWS}}

## How to score

Score from 1 to 10 per device (desktop, mobile), for each product in the pack, with the same axes. 10 is the best product of this kind that you know. 7 is solid but clearly behind the best. Half points are allowed. Judge the other job boards only on the screens shown.

Axes, by id:

{{AXES}}

Then say what must stay as it is. Name the product, screen and device for each item.

Then, for each FastCV build, list the five fixes that raise the score most, most important first. Each fix names the screen, the device, the problem and the change. Be specific: "the card title and salary have the same size on the feed on mobile; make the title 18 px and the salary 14 px" is useful, "improve spacing" is not.

## Reply format

Write your review in plain prose and short lists. End the reply with exactly one fenced `json` block in this shape, with your numbers and your fixes:

```json
{{JSON}}
```
