/* ================================================================
   PITCHLY — starter-content.js
   Bibliothèque d'objections pré-écrites par secteur (clés alignées
   sur LABELS_SECTEUR dans auth.js). Sert de filet pour les nouveaux
   utilisateurs : tant qu'ils n'ont pas leurs propres réponses "qui
   ont marché", objections.js complète avec ce contenu pour que le
   feedback loop apporte de la valeur dès la première génération.

   Pas d'entrée pour un secteur "autre" (texte libre) — comportement
   inchangé dans ce cas : aucun exemple de bibliothèque proposé.
   ================================================================ */

const STARTER_OBJECTIONS = {
  coaching: [
    {
      objection: "c'est trop cher pour moi",
      reponse: "Je comprends que le prix soit un frein. Beaucoup de mes clients ont eu la même hésitation au départ, et ce qui a fait la différence, c'est de voir l'accompagnement comme un investissement sur plusieurs mois, pas une dépense ponctuelle. On peut aussi voir ensemble une formule plus légère pour démarrer, si ça vous aide à vous décider.",
    },
    {
      objection: 'je vais réfléchir',
      reponse: "Bien sûr, c'est une décision importante. Qu'est-ce qui vous ferait hésiter concrètement : le prix, le format, ou le moment ? Ça m'aiderait à savoir si je peux répondre à quelque chose maintenant plutôt que de vous laisser réfléchir dans le flou.",
    },
    {
      objection: "je n'ai pas le temps en ce moment",
      reponse: "C'est justement pour les personnes très prises que l'accompagnement fait le plus de différence : l'idée n'est pas d'ajouter une charge, mais de vous aider à avancer plus vite sur ce qui compte. On peut caler des séances courtes qui s'adaptent à votre emploi du temps plutôt que l'inverse.",
    },
  ],

  artisanat: [
    {
      objection: 'j’ai un autre devis moins cher',
      reponse: "C'est normal de comparer, c'est une bonne chose. Est-ce que le devis en face inclut les mêmes prestations et la même garantie ? Souvent l'écart de prix vient de ce qui n'est pas inclus — je préfère être transparent sur ce qui est compris plutôt que de vous surprendre après coup.",
    },
    {
      objection: 'je dois en parler à mon conjoint',
      reponse: "C'est complètement normal pour un chantier de cette taille. Je peux vous laisser le devis détaillé pour que vous en discutiez tranquillement, et je reste disponible si vous avez des questions à deux. Voulez-vous qu'on refixe un point dans les prochains jours ?",
    },
    {
      objection: 'les délais sont trop longs',
      reponse: "Je comprends, personne n'aime attendre. Ce délai me permet de faire un travail soigné sans bâcler, et j'ai peu d'imprévus grâce à ça. Si la date est vraiment bloquante pour vous, dites-le-moi : je peux regarder ce qui est possible pour avancer certaines étapes.",
    },
  ],

  conseil: [
    {
      objection: "on n'a pas le budget cette année",
      reponse: "Je comprends la contrainte. Est-ce que c'est vraiment une question de budget global, ou plutôt de priorité sur ce type de sujet en ce moment ? Si c'est une question de timing, on peut regarder ensemble un périmètre plus restreint qui rentre dans ce qui est disponible.",
    },
    {
      objection: 'on préfère gérer ça en interne',
      reponse: "C'est une option tout à fait valable si vous avez le temps et l'expertise en interne. Ce que j'apporte en plus, c'est un regard extérieur et le temps dédié que vos équipes n'ont souvent pas au quotidien. On peut aussi envisager un format où j'interviens en soutien ponctuel plutôt qu'en remplacement.",
    },
    {
      objection: "on a déjà travaillé avec un consultant, ça n'a rien donné",
      reponse: "Je comprends la méfiance, une mauvaise expérience marque. Qu'est-ce qui n'avait pas fonctionné à l'époque : la méthode, le suivi, les résultats concrets ? Ça m'aide à comprendre ce qu'il faut faire différemment pour que ça vous soit vraiment utile cette fois.",
    },
  ],

  creatif: [
    {
      objection: 'c’est plus cher que ce que je pensais',
      reponse: "Je comprends, le budget créatif est souvent sous-estimé au départ. Le tarif reflète le temps de conception et les allers-retours inclus pour arriver à un résultat qui vous ressemble vraiment. On peut aussi ajuster le périmètre pour coller à votre budget si besoin.",
    },
    {
      objection: 'je peux le faire moi-même avec Canva',
      reponse: "C'est tout à fait possible pour un usage ponctuel. La différence, c'est le temps que vous n'aurez pas à y passer et une cohérence visuelle pensée pour votre image sur la durée, pas juste un visuel isolé. Si votre priorité c'est le temps gagné, ça vaut le coup d'en discuter.",
    },
    {
      objection: "j'ai besoin de voir d'autres exemples avant de me décider",
      reponse: "Bien sûr, c'est normal de vouloir se projeter. Je peux vous montrer des projets proches de ce que vous recherchez pour vous donner une idée concrète du style et de la qualité. Qu'est-ce qui vous aiderait le plus : des exemples dans votre secteur, ou dans un style similaire ?",
    },
  ],

  commerce: [
    {
      objection: "c'est plus cher qu'ailleurs",
      reponse: "Je comprends que le prix compte. Est-ce que la comparaison porte sur exactement le même produit, avec la même qualité et le même service après-vente ? Je préfère être honnête sur ce qui justifie l'écart plutôt que de baisser artificiellement le prix.",
    },
    {
      objection: "je vais comparer avec d'autres options",
      reponse: "C'est une bonne idée, prenez le temps qu'il faut. Pendant que vous comparez, n'hésitez pas si des questions vous viennent, je reste disponible. Qu'est-ce qui compte le plus pour vous dans le choix final : le prix, la qualité, ou le délai ?",
    },
    {
      objection: 'je ne suis pas sûr que ça va me convenir',
      reponse: "C'est une hésitation légitime. Qu'est-ce qui vous fait douter précisément ? Si c'est une question d'adéquation, je peux vous en dire plus sur des cas similaires au vôtre pour vous aider à visualiser si ça correspond à votre besoin.",
    },
  ],
};
