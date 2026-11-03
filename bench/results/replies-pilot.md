# Replies pilot

7 real calls to `claude -p --model haiku` (claude-haiku-5-5), tools off, user settings off.
The system prompt is `systemPrompt({ thinking })` with the skill in `skill/SKILL.md`.
Each reply is linted by `skill/scripts/reread.mjs`.

- "Hard (app)" is what `lib/filter.mjs` counts: hard hits except `long-line`, which the renderer wraps.
- "Hard (plan)" adds the study-plan checks when `wantsPlan(prompt)` is true.
- "Out tokens" counts private thinking too, so it is far above the words shown when the model thinks first.

| # | Prompt | Thinking | Words | Seconds | Out tokens | Hard (app) | Hard (plan) | Soft | Long lines ignored |
|---|--------|----------|------:|--------:|-----------:|-----------:|------------:|-----:|-------------------:|
| 1 | explain photosynthesis | off | 111 | 2.4 | 280 | 0 | n/a | 10 | 1 |
| 2 | I have a history exam on Friday on the Cold War | off | 155 | 6.5 | 1253 | 0 | 0 | 1 | 0 |
| 3 | how do I set up a budget | off | 104 | 3.1 | 211 | 0 | n/a | 6 | 0 |
| 4 | what is the difference between RAM and storage | off | 109 | 2.2 | 216 | 2 | n/a | 5 | 1 |
| 5 | I have a history exam on Friday on the Cold War | strong | 145 | 5.5 | 974 | 0 | 0 | 2 | 0 |
| 6 | I have a history exam on Friday on the Cold War | strong (private thinking off) | 143 | 7.6 | 1169 | 0 | 0 | 0 | 0 |

## 1. explain photosynthesis (thinking: off)

2.4 s, 280 tokens out, $0.0009. Study-plan prompt: no.

No hard hits.

Soft hits:

- 1:1 long-word: "Photosynthesis" is long (14 letters, 5 syllables)
- 1:71 long-line: 75 characters (aim for 70 or fewer)
- 4:71 long-line: 73 characters (aim for 70 or fewer)
- 5:71 long-line: 77 characters (aim for 70 or fewer)
- 7:71 long-line: 78 characters (aim for 70 or fewer)
- 8:71 long-line: 75 characters (aim for 70 or fewer)
- 10:1 long-sentence: 17 words (aim for 15 or fewer)
- 10:29 acronym: "CO" is not spelled out at first use
- 10:59 long-words: 3 long words in one sentence (aim for 2 or fewer)
- 12:71 long-line: 73 characters (aim for 70 or fewer)

Reply:

````markdown
Photosynthesis turns light, water and carbon dioxide into sugar and oxygen.

- **Where:** It happens in chloroplasts, inside plant leaf cells.
- **Pigment:** Chlorophyll absorbs red and blue light. It reflects green.
- **Light stage:** Light splits water. This makes oxygen and energy carriers.
- **Oxygen:** The plant releases the oxygen into the air.
- **Sugar stage:** The Calvin cycle uses those carriers to fix carbon dioxide.
- **Product:** The plant builds glucose, which it uses or stores as starch.

The overall equation is six CO₂ plus six H₂O, using light energy, giving C₆H₁₂O₆ plus six O₂.

Do you want the light stage or the Calvin cycle explained in more detail?
````

## 2. I have a history exam on Friday on the Cold War (thinking: off)

6.5 s, 1253 tokens out, $0.0008. Study-plan prompt: yes.

No hard hits.

Soft hits:

- 2:71 long-line: 71 characters (aim for 70 or fewer)

Reply:

````markdown
Goal: know the main Cold War events well enough for Friday's exam.
Assumed: about 90 minutes free today, and the exam covers 1945 to 1991.

1. Write the five Cold War topics on one page. (1 min)
2. Make a timeline from 1945 to 1991. (20 min)
3. Break (5 min)
4. Write notes on the Truman Doctrine and Marshall Plan. (25 min)
5. Write notes on the arms race and Cuban Missile Crisis. (20 min)
6. Break (5 min)
7. Answer three practice essay questions from memory. (20 min)

Checklist:

- [ ] Write the five topics on one page
- [ ] Make a timeline from 1945 to 1991
- [ ] Write notes on the Truman Doctrine and Marshall Plan
- [ ] Write notes on the arms race and Cuban Missile Crisis
- [ ] Answer three practice essay questions from memory

Next: start step 1 now. It takes one minute.
````

## 3. how do I set up a budget (thinking: off)

3.1 s, 211 tokens out, $0.0002. Study-plan prompt: no.

No hard hits.

Soft hits:

- 1:1 first-line: 13 words (aim for 12 or fewer)
- 1:71 long-line: 74 characters (aim for 70 or fewer)
- 3:1 long-list: 8 items (aim for 7 or fewer)
- 4:28 long-word: "utilities" is long (9 letters, 4 syllables)
- 4:46 long-word: "subscriptions" is long (13 letters, 3 syllables)
- 7:34 long-word: "category" is long (8 letters, 4 syllables)

Reply:

````markdown
The simplest budget is a list of income, fixed costs, and spending limits.

1. Write down your monthly take-home pay.
2. List fixed bills: rent, utilities, phone, subscriptions.
3. Subtract bills from pay. That is your spending money.
4. Check last month's bank and card statements for typical spending.
5. Set a limit for each spending category, such as food or fun.
6. Pick a tool: a spreadsheet, a notes app, or a budget app.
7. Each week, compare what you spent with your limits.
8. Adjust the limits at the end of each month.

Do you want a simple template for a spreadsheet?
````

## 4. what is the difference between RAM and storage (thinking: off)

2.2 s, 216 tokens out, $0.0003. Study-plan prompt: no.

Hard hits:

- 4:3 repeated-label: "ram" starts 2 bullets, like a grid
- 6:3 repeated-label: "storage" starts 2 bullets, like a grid

Soft hits:

- 1:1 acronym: "RAM" is not spelled out at first use
- 1:13 long-word: "temporary" is long (9 letters, 4 syllables)
- 3:40 long-word: "actively" is long (8 letters, 4 syllables)
- 4:18 long-word: "everything" is long (10 letters, 4 syllables)
- 5:42 long-word: "operating" is long (9 letters, 4 syllables)

Reply:

````markdown
RAM is fast temporary memory, while storage keeps data long term.

- **RAM:** Holds what your computer is actively using right now.
- **RAM:** Loses everything when the power turns off.
- **Storage:** Keeps files, apps and the operating system saved.
- **Storage:** Keeps data even when the power is off.
- **Speed:** RAM is much faster to read and write.
- **Size:** Storage is usually much bigger, measured in terabytes.

Think of RAM as your desk and storage as your filing cabinet. You work on documents at the desk, then file them away when you finish.

Would you like to know how much RAM or storage you need?
````

Rewrite, as the app sends it after these hard hits:

- repeated-label: "ram" starts 2 bullets, like a grid
- repeated-label: "storage" starts 2 bullets, like a grid

1.9 s. Hard hits left: 0.

````markdown
RAM is fast, temporary memory, while storage keeps data long term.

| | **RAM** | **Storage** |
|---|---|---|
| **Holds** | What your computer is using right now | Files, apps and the operating system |
| **After power off** | Everything is lost | Data is kept |
| **Speed** | Much faster to read and write | Slower than RAM |
| **Size** | Smaller, measured in gigabytes | Bigger, usually measured in terabytes |

Think of RAM as your desk and storage as your filing cabinet. You work on documents at the desk, then file them away when you finish.

Would you like to know how much RAM or storage you need?
````

## 5. I have a history exam on Friday on the Cold War (thinking: strong)

5.5 s, 974 tokens out, $0.0014. Study-plan prompt: yes.

No hard hits.

Soft hits:

- 2:71 long-line: 76 characters (aim for 70 or fewer)
- 7:18 long-word: "superpowers" is long (11 letters, 4 syllables)

Reply:

````markdown
Goal: know the Cold War's causes, key events and effects, by Friday.
Assumed: the exam is Friday 6 November, and you have about one hour tonight.

1. Write the exam topics on one page. (2 min)
2. Make a timeline of the main Cold War dates. (20 min)
3. Break. (5 min)
4. Learn why the superpowers became rivals after 1945. (25 min)
5. Learn the big crises: Berlin, Korea and Cuba. (20 min)
6. Break. (5 min)
7. Answer one past exam question out loud, from memory. (20 min)

Checklist:

- [ ] Step 1: write the exam topics
- [ ] Step 2: make the timeline
- [ ] Step 4: learn the causes
- [ ] Step 5: learn the crises
- [ ] Step 7: answer one question aloud

Next: do step 1 now, then tell me the topics you wrote.
````

## 6. I have a history exam on Friday on the Cold War (thinking: strong, private thinking off)

7.6 s, 1169 tokens out, $0.0006. Study-plan prompt: yes.

No hard hits.

No soft hits.

Reply:

````markdown
Goal: be ready for the Cold War exam by Friday.

Assumed: the exam covers 1945 to 1991, with short and essay questions.

1. Check your notes for the exam topics (1 min)
2. Make a timeline of 10 key dates (20 min)
3. Break (5 min)
4. Write 5 causes of the Cold War, one line each (25 min)
5. Learn 4 crises: Berlin, Korea, Cuba, Vietnam (20 min)
6. Break (5 min)
7. Answer one essay question out loud, from memory (20 min)

Checklist:

- [ ] Check your notes for the exam topics
- [ ] Make a timeline of 10 key dates
- [ ] Write 5 causes of the Cold War
- [ ] Learn 4 crises
- [ ] Answer one essay question out loud

Next: send me your exam topics, and I will make the next session.
````
