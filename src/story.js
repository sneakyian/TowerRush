// The campaign's story: a prologue, a briefing before every level, a taunt
// from each boss, words after each victory, and an epilogue. `{hero}` is
// replaced with the chosen hero's name.

export const STORY = {
  prologue: {
    title: 'The Marches of Aldermere',
    lines: [
      { speaker: 'King Osric', text: 'Warden. The beacons on the eastern ridge burned red last night, and no rider has come back from the caldera road.' },
      { speaker: 'King Osric', text: 'The old fire under the mountain is awake. Something is calling the wild tribes down from the hills and up from the bogs.' },
      { speaker: 'King Osric', text: 'You hold the marches. Raise your towers, keep the road, and send {hero} wherever the line is thinnest.' },
    ],
  },
  levels: {
    greenfields: {
      title: 'Chapter I — Greenfields',
      lines: [
        { speaker: 'Scout Wren', text: 'Goblins, Warden. Hundreds of them, out of the Thornback hills, with wolves running ahead and orcs bringing up the rear.' },
        { speaker: 'Scout Wren', text: 'Their warlord, Grukk, wants the harvest and the castle both. His shamans keep his raiders on their feet.' },
        { speaker: '{hero}', text: 'Then we take the shamans first. Show me the road.' },
      ],
      taunt: 'Grukk: "Burn the fields! Leave them nothing but ash and ours!"',
      victory: [
        { speaker: 'Scout Wren', text: 'Grukk is down and the hills are quiet. But the goblins carried a banner I have never seen: a dragon in red thread.' },
        { speaker: 'King Osric', text: 'Then it is as I feared. Ride north. The Frostpeak garrison has gone silent.' },
      ],
    },
    frostpeak: {
      title: 'Chapter II — Frostpeak Pass',
      lines: [
        { speaker: 'Captain Halla', text: 'The pass is ours only while the switchbacks hold. Yetis come down in the blizzards, and the ice sprites fly straight over our walls.' },
        { speaker: 'Captain Halla', text: 'The trolls heal faster than we can cut them. Fire, Warden. Bring fire, or we lose the north.' },
        { speaker: '{hero}', text: 'The cold will not stop me. Point me at the giant.' },
      ],
      taunt: 'Frost Giant: "Your little fires will gutter. The mountain is mine, and the mountain is patient."',
      victory: [
        { speaker: 'Captain Halla', text: 'The giant lies in the snow and the pass is clear. The sprites were herding the yetis south, toward the desert crossing.' },
        { speaker: 'King Osric', text: 'Sunscorch. The caravans stopped a week ago. Find out why.' },
      ],
    },
    sunscorch: {
      title: 'Chapter III — Sunscorch Desert',
      lines: [
        { speaker: 'Caravan Master Idris', text: 'The dunes move at night, Warden. Golems rise out of the sand, and when you break them they only get smaller and angrier.' },
        { speaker: 'Caravan Master Idris', text: 'The bandits of the Red Scarf have thrown in with the beasts. Slippery as oil, every one of them. And the wasps... bring something that can reach the sky.' },
        { speaker: '{hero}', text: 'Lightning cracks stone. We will see how the golems like it.' },
      ],
      taunt: 'Sand Wyrm: "You walk on my back and call it a road. I will swallow the road."',
      victory: [
        { speaker: 'Caravan Master Idris', text: 'The wyrm is dead and the caravans roll again. Its belly was full of swamp-moss and witch-charms.' },
        { speaker: 'King Osric', text: 'Murkwater. The witches of the bog have kept to themselves for a hundred years. Something has bought them.' },
      ],
    },
    murkwater: {
      title: 'Chapter IV — Murkwater Swamp',
      lines: [
        { speaker: 'Hermit Oda', text: 'The witches shield their wisps and mend their trolls, and the wisps blink along the road faster than an arrow flies.' },
        { speaker: 'Hermit Oda', text: 'In the deep pool sleeps the Hydra. Cut one head and two grow back. Poison is nothing to it; burn it, and keep burning.' },
        { speaker: '{hero}', text: 'Then the bog will burn. Stand back, old one.' },
      ],
      taunt: 'Hydra: "We are many. We are patient. We will drink your castle dry."',
      victory: [
        { speaker: 'Hermit Oda', text: 'The Hydra sinks and the mist lifts. The witches spoke a name as they fled: Vexarion, the Ember Dragon.' },
        { speaker: 'King Osric', text: 'So the mountain has a master. Everything we have fought was his. Ride to the caldera, Warden, and end it.' },
      ],
    },
    caldera: {
      title: 'Chapter V — Ember Caldera',
      lines: [
        { speaker: 'King Osric', text: 'This is the last road. Imps that burst into flame when they die, hounds that run faster the more they bleed, wraiths that drift over every wall.' },
        { speaker: 'King Osric', text: 'And Vexarion himself, warded in fire, who calls his brood to him when he is hurt. Frost is the only thing he fears.' },
        { speaker: '{hero}', text: 'Then he will fear me. For Aldermere.' },
      ],
      taunt: 'Vexarion: "I burned this kingdom once, when your grandsires were children. I remember the taste."',
      victory: [
        { speaker: '{hero}', text: 'It is done. The dragon is ash and the mountain sleeps.' },
        { speaker: 'Scout Wren', text: 'Warden... the caldera floor has split open. There are stairs going down. Lit stairs.' },
      ],
    },
    dis: {
      title: 'Part II, Chapter VI — Gates of Dis',
      lines: [
        { speaker: 'King Osric', text: 'Vexarion was never the master. Below the mountain lies the Underworld, and something there armed him. Our scouts found a gate of black iron, and it was open.' },
        { speaker: 'Scout Wren', text: 'The road down glows, Warden. Rivers of fire, and lights in colours that have no names. The dead walk it, and worse than the dead.' },
        { speaker: 'Royal Artificer Tamsin', text: 'I have something for you. A well that bends the ground itself. Nothing walks quickly through it. Take it; you will need every step they lose.' },
        { speaker: '{hero}', text: 'Then we go down. Hold the gate behind me.' },
      ],
      taunt: 'Baal: "Turn back, little light. The gate opens only one way."',
      victory: [
        { speaker: 'Scout Wren', text: 'The Warden of the Gate is broken. Beyond it the tunnels open into a city, Warden. A city, lit like a festival, and every lamp a soul.' },
        { speaker: 'Royal Artificer Tamsin', text: 'The gate golems were full of black powder. I can make rockets from it. Give me a day.' },
      ],
    },
    neon: {
      title: 'Part II, Chapter VII — Neon Sprawl',
      lines: [
        { speaker: 'Royal Artificer Tamsin', text: 'Rockets, Warden. They fly true, they fly high, and they burst. Nothing in the sky is safe from them now.' },
        { speaker: 'Hermit Oda', text: 'The city is ruled by Nyx, the Neon Queen. Her shades slip through arrows like smoke, and her succubi can silence a tower with a word. Kill the singers first.' },
        { speaker: '{hero}', text: 'Let her sing. I have heard worse in the swamp.' },
      ],
      taunt: 'Nyx: "Welcome to my city, Warden. Stay. Everyone stays."',
      victory: [
        { speaker: 'Hermit Oda', text: 'The queen is dark and the lamps are going out one by one. There is a stair below the throne, and heat coming up it like a furnace.' },
        { speaker: 'King Osric', text: 'Then that is where it sits. The thing that woke the dragon, that bought the witches, that opened the gate. Finish it, Warden.' },
      ],
    },
    pit: {
      title: 'Part II, Chapter VIII — Throne of the Pit',
      lines: [
        { speaker: 'King Osric', text: 'Moloch, Lord of the Pit. Every war we have fought was his hand on a different puppet. He sits on a throne of everything he has ever burned.' },
        { speaker: 'Hermit Oda', text: 'He is warded in fire and he heals like the tide. His angels fell with him and mend him still. His cultists will hex your towers. Frost, Warden. Frost and patience.' },
        { speaker: '{hero}', text: 'I did not come this far to be patient. But I will bring the frost.' },
      ],
      taunt: 'Moloch: "You climbed down into my mouth, Warden. I need only close it."',
      victory: [
        { speaker: '{hero}', text: 'Moloch is unmade. The fire is going out below us.' },
      ],
    },
  },
  interlude: {
    title: 'Part I complete',
    lines: [
      { speaker: 'King Osric', text: 'The dragon is dead and the realm breathes. But the stairs under the caldera go down, and they are lit. The war is not over, Warden. It has only found its true shape.' },
      { speaker: 'King Osric', text: 'Part II opens on the level screen. New engines of war await you below.' },
    ],
  },
  epilogue: {
    title: 'The Pit Goes Dark',
    lines: [
      { speaker: 'King Osric', text: 'The fire under the world is out. The gate of black iron is sealed with the stone of three mountains, and the beacons burn white from Greenfields to the caldera.' },
      { speaker: 'King Osric', text: 'Aldermere stands because you held the road, Warden, and because {hero} walked into hell and did not step back.' },
      { speaker: 'Scout Wren', text: 'Go home. Sleep. If the lamps of Dis ever light again, you will be the first I wake.' },
    ],
  },
};

// Fill in the hero's name.
export function storyText(text, heroName) {
  return text.replace(/\{hero\}/g, heroName);
}
