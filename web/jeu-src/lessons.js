// Contenu pédagogique extrait de docs/KISS_v2_GeniusPay.odp (3 diapositives).
// Chaque question cite sa diapositive source, comme le demande le dossier de décision.

export const MISSIONS = [
  { id: 1, title: 'Mission 1 · Le principe', color: '#FDE3B0', zStart: 0, zEnd: 17 },
  { id: 2, title: 'Mission 2 · Google & KISS', color: '#CFE8D5', zStart: 17, zEnd: 23 },
  { id: 3, title: 'Mission 3 · KISS en pratique', color: '#D6E0F5', zStart: 23, zEnd: 41 },
];

export const QUESTIONS = [
  {
    missionId: 1,
    source: 'Diapositive 1',
    question: 'Que signifie KISS ?',
    choices: [
      'Keep It Simple, Stupid',
      'Keep It Safe, Secure',
      'Know It, Share It, Stop',
      'Keep Iterating, Shipping Often',
    ],
    answer: 0,
    explanation: 'KISS = Keep It Simple, Stupid : la simplicité comme principe de conception.',
  },
  {
    missionId: 1,
    source: 'Diapositive 1',
    question: 'Quelle idée centrale KISS défend-il ?',
    choices: [
      'La simplicité comme principe de conception',
      "La multiplication des fonctionnalités",
      'L’utilisation de bibliothèques lourdes',
      'La documentation exhaustive',
    ],
    answer: 0,
    explanation: 'La diapositive 1 pose la simplicité comme principe de conception.',
  },
  {
    missionId: 2,
    source: 'Diapositive 2',
    question: 'Quelle comparaison illustre KISS ?',
    choices: [
      'AltaVista surchargé vs Google épuré',
      'Windows vs Linux',
      'Un cours magistral vs un QCM',
      'Un PDF vs une photo',
    ],
    answer: 0,
    explanation: 'AltaVista était surchargé, Google est épuré : c’est le KISS en action.',
  },
  {
    missionId: 3,
    source: 'Diapositive 3',
    question: 'Quelle est la 2e étape pour appliquer KISS ?',
    choices: [
      'Clarifier les objectifs',
      'Décomposer le problème',
      'Se limiter au nécessaire',
      'Appliquer KISS',
    ],
    answer: 1,
    explanation: 'Ordre : 1 Clarifier les objectifs · 2 Décomposer le problème · 3 Se limiter au nécessaire · 4 Appliquer KISS.',
  },
  {
    missionId: 3,
    source: 'Diapositive 3',
    question: 'Lequel de ces domaines n’est PAS cité comme terrain d’application de KISS ?',
    choices: [
      'Développement logiciel',
      'Gestion de projet',
      'Marketing commercial',
      'Architecture logicielle',
    ],
    answer: 2,
    explanation: 'Les domaines cités sont : développement logiciel, UX/UI design, architecture logicielle et gestion de projet.',
  },
  {
    missionId: 3,
    source: 'Diapositive 3',
    question: 'Quel bénéfice KISS apporte-t-il chez GeniusPay ?',
    choices: [
      'Limiter les bugs',
      'Ajouter plus de fonctionnalités',
      'Multiplier les dépendances',
      'Allonger les cycles de livraison',
    ],
    answer: 0,
    explanation: 'Chez GeniusPay, KISS réduit le temps de dev, limite les bugs, facilite la maintenance et permet de livrer plus vite.',
  },
];
