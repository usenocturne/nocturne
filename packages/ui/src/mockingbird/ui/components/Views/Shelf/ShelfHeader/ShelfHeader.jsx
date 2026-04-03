import { useEffect, useState } from 'react';
import { HOME_IDENTIFIER, VOICE_IDENTIFIER, YOUR_LIBRARY } from '../../../../stores/ShelfStore';
import {
  IconLibrary32,
  IconHome32,
  IconHomeActive32,
  IconSearch32,
  IconSearchActive,
  IconLibraryActive,
} from '../../../Icons/CarthingUIComponents';
import styles from './ShelfHeader.module.scss';
import ShelfHeaderItem from './ShelfHeaderItem';
import { observer } from 'mobx-react-lite';
import { useCarThingStore } from '../../../../contexts/CarThingStore';

export const CATEGORY_ICONS = {
  [HOME_IDENTIFIER]: {
    components: {
      active: <IconHomeActive32 />,
      inactive: <IconHome32 />,
    },
    iconMargin: 10,
  },
  [VOICE_IDENTIFIER]: {
    components: {
      active: <IconSearchActive iconSize={32} />,
      inactive: <IconSearch32 />,
    },
    iconMargin: 8,
  },
  [YOUR_LIBRARY]: {
    components: {
      active: <IconLibraryActive iconSize={32} />,
      inactive: <IconLibrary32 />,
    },
    iconMargin: 6,
  },
};

const ShelfHeader = () => {
  const [titleRefs, setTitleRefs] = useState([]);
  const { shelfStore } = useCarThingStore();
  const uiState = shelfStore.shelfController.headerUiState;
  const numberOfMainCategories = uiState.mainCategoriesCount;

  useEffect(() => {
    setTitleRefs([]);
  }, [uiState.mainCategoriesCount]);

  const addTitleRef = (index, ref) => {
    setTitleRefs((existingRefs) => {
      const titleRef = existingRefs[index];
      if (!titleRef) {
        const newRefs = [...existingRefs];
        newRefs[index] = ref;
        return newRefs;
      }
      return existingRefs;
    });
  };

  const getTitleTranslateLeft = (index) => {
    return (
      titleRefs
        .slice(0, index)
        .reduce(
          (sum, titleRef) =>
            titleRef.titleTextRef
              ? sum + titleRef.titleTextRef.offsetWidth
              : sum,
          0,
        ) +
      8 * index
    );
  };

  const yourLibTranslateLeft = getTitleTranslateLeft(
    numberOfMainCategories + 1,
  );

  const activeTitleRef = titleRefs[uiState.activeTitleIndex];
  let underlineTranslateX;
  if (!activeTitleRef || !activeTitleRef.titleContainerRef) {
    underlineTranslateX = 0;
  } else if (uiState.isInYourLibrary) {
    underlineTranslateX =
      activeTitleRef.titleContainerRef.offsetLeft - yourLibTranslateLeft;
  } else {
    underlineTranslateX = activeTitleRef.titleContainerRef.offsetLeft;
  }

  return (
    <>
      <div className={styles.shelfTitles}>
        {uiState.mainCategories.map((category, index) => (
          <ShelfHeaderItem
            key={category.parsedId}
            id={category.parsedId}
            icon={CATEGORY_ICONS[category.parsedId]?.components}
            iconMargin={CATEGORY_ICONS[category.parsedId]?.iconMargin}
            marginRight={40}
            title={category.name}
            visible={true}
            active={uiState.isSelectedItemCategory(category.parsedId)}
            onlyIcon={uiState.isInYourLibrary}
            translateLeft={getTitleTranslateLeft(index)}
            ref={(ref) => addTitleRef(index, ref)}
          />
        ))}

        <ShelfHeaderItem
          id={YOUR_LIBRARY}
          icon={CATEGORY_ICONS[YOUR_LIBRARY]?.components}
          iconMargin={CATEGORY_ICONS[YOUR_LIBRARY]?.iconMargin}
          marginRight={40}
          title="Your Library"
          visible={true}
          active={uiState.isInYourLibrary}
          onlyIcon={uiState.isInYourLibrary}
          translateLeft={getTitleTranslateLeft(numberOfMainCategories)}
          ref={(ref) => addTitleRef(numberOfMainCategories, ref)}
        />

        {uiState.yourLibraryCategories.map((category, index) => (
          <ShelfHeaderItem
            key={category.parsedId}
            id={category.parsedId}
            marginRight={24}
            title={category.name}
            visible={uiState.isInYourLibrary}
            active={uiState.isSelectedItemCategory(category.parsedId)}
            translateLeft={yourLibTranslateLeft}
            ref={(ref) => addTitleRef(numberOfMainCategories + index + 1, ref)}
          />
        ))}
      </div>

      <div className={styles.titleUnderlineContainer}>
        {activeTitleRef && activeTitleRef.titleContainerRef && (
          <div
            className={styles.titleUnderline}
            style={{
              transform: `translateX(${underlineTranslateX}px)
                          scaleX(${activeTitleRef.titleContainerRef.offsetWidth})`,
            }}
          />
        )}
      </div>
    </>
  );
};

export default observer(ShelfHeader);
