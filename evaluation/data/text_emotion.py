"""Labelled sentences for text-emotion evaluation.

Hand-authored rather than drawn from a public corpus, for two reasons: it needs
no download on a memory-constrained machine, and the phrasing matches how people
actually talk to an assistant, which is the distribution that matters here.
Public benchmarks (GoEmotions, ISEAR) are largely social-media or narrative text
and score differently.

Ten per class across the seven labels the fusion engine uses. Deliberately
includes hard cases — negation, sarcasm, mixed sentiment — so the number is not
flattered by only testing obvious examples.
"""

SAMPLES: list[tuple[str, str]] = [
    # --- happy ---
    ("I got the internship! I actually got it!", "happy"),
    ("Today has been genuinely lovely from start to finish.", "happy"),
    ("I'm so proud of how the demo turned out.", "happy"),
    ("Can't stop smiling, my results came back great.", "happy"),
    ("Spending the afternoon with my friends was exactly what I needed.", "happy"),
    ("This is the best news I've had all month.", "happy"),
    ("I feel light today, everything is just clicking.", "happy"),
    ("We finally finished the project and it works beautifully.", "happy"),
    ("Thank you, that genuinely made my day.", "happy"),
    ("I'm really looking forward to the trip next week.", "happy"),
    # --- sad ---
    ("I don't really want to talk about it, I just feel empty.", "sad"),
    ("Nothing I do seems to matter lately.", "sad"),
    ("I miss how things used to be.", "sad"),
    ("I've been crying on and off all evening.", "sad"),
    ("I failed the exam and I don't know what to do now.", "sad"),
    ("Everyone seems to be moving forward except me.", "sad"),
    ("I feel completely alone even in a room full of people.", "sad"),
    ("It's been a long, heavy week and I'm worn down.", "sad"),
    ("I lost someone close to me last month.", "sad"),
    ("I'm just tired of trying so hard for nothing.", "sad"),
    # --- angry ---
    ("This is absolutely unacceptable and nobody will take responsibility.", "angry"),
    ("I'm furious that they went ahead without asking me.", "angry"),
    ("Stop interrupting me, I'm sick of it.", "angry"),
    ("They wasted three weeks of my work and didn't even apologise.", "angry"),
    ("I can't believe how badly this was handled.", "angry"),
    ("Every single time, the same excuse. I've had enough.", "angry"),
    ("It infuriates me that nobody checked before deploying.", "angry"),
    ("Don't tell me to calm down, that makes it worse.", "angry"),
    ("I'm so annoyed I could scream right now.", "angry"),
    ("This whole situation is completely unfair and they know it.", "angry"),
    # --- fear ---
    ("I'm terrified I'm going to fail the viva tomorrow.", "fear"),
    ("What if something goes wrong during the demo?", "fear"),
    ("My heart is racing and I don't know why.", "fear"),
    ("I'm scared to open the results page.", "fear"),
    ("I keep worrying that they'll find out I don't know enough.", "fear"),
    ("There's a strange noise outside and I'm home alone.", "fear"),
    ("I'm anxious about the presentation and can't sleep.", "fear"),
    ("I'm dreading that conversation all week.", "fear"),
    ("What if I've made a terrible mistake?", "fear"),
    ("The thought of speaking in front of everyone makes me panic.", "fear"),
    # --- surprise ---
    ("Wait, they announced it already? I had no idea!", "surprise"),
    ("You're joking — she actually said yes?", "surprise"),
    ("I did not expect that result at all.", "surprise"),
    ("Whoa, where did that come from?", "surprise"),
    ("They showed up at my door completely unannounced.", "surprise"),
    ("I opened the box and could not believe what was inside.", "surprise"),
    ("That plot twist came out of nowhere.", "surprise"),
    ("Seriously? It finished in under a second?", "surprise"),
    ("I just found out I've been selected. I'm stunned.", "surprise"),
    ("Out of nowhere, the whole thing just started working.", "surprise"),
    # --- disgust ---
    ("That milk has completely turned, it smells foul.", "disgust"),
    ("The state of that kitchen was revolting.", "disgust"),
    ("I can't stand the way he talks about people behind their backs.", "disgust"),
    ("There was mould all over it, I nearly gagged.", "disgust"),
    ("That's such a sleazy way to treat customers.", "disgust"),
    ("The smell in that room made me want to leave immediately.", "disgust"),
    ("I find their whole attitude genuinely repulsive.", "disgust"),
    ("It was greasy and cold and honestly inedible.", "disgust"),
    ("Cheating on the exam like that is just grim.", "disgust"),
    ("The bathroom was filthy, I couldn't use it.", "disgust"),
    # --- neutral ---
    ("The meeting is at four in room 302.", "neutral"),
    ("Set a reminder for tomorrow morning please.", "neutral"),
    ("What's the weather going to be like later?", "neutral"),
    ("I need to submit the form before Friday.", "neutral"),
    ("Open the project folder on my desktop.", "neutral"),
    ("The train leaves from platform nine.", "neutral"),
    ("Can you list what I have scheduled this week?", "neutral"),
    ("I'll be working from the library this afternoon.", "neutral"),
    ("The file is about two hundred megabytes.", "neutral"),
    ("Remind me to call the department office.", "neutral"),
]


def load() -> tuple[list[str], list[str]]:
    """Return (texts, labels)."""
    return [t for t, _ in SAMPLES], [l for _, l in SAMPLES]
