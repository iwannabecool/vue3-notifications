import { HTMLAttributes, PropType, SlotsType, TransitionGroup, TransitionGroupProps, computed, defineComponent, onMounted, onUnmounted, ref } from 'vue';
import { params } from '@/params';
import { Id, listToDirection, emitter, parse } from '@/utils';
import defaults from '@/defaults';
import { NotificationItem, NotificationsOptions } from '@/types';
import { createTimer, NotificationItemWithTimer } from '@/utils/timer';
import './Notifications.css';

const STATE = {
  IDLE: 0,
  DESTROYED: 2,
} as const;

type NotificationItemState = typeof STATE;

type NotificationItemExtended = NotificationItemWithTimer & {
  state: NotificationItemState[keyof NotificationItemState];
}

export default defineComponent({
  // eslint-disable-next-line vue/multi-word-component-names
  name: 'notifications',
  props: {
    group: {
      type: String,
      default: '',
    },
    /** 
     * Width of notification holder, can be `%`, `px` string or number.
     * @example '100%', '200px', 200 
     * */
    width: {
      type: [Number, String],
      default: 300,
    },

    reverse: {
      type: Boolean,
      default: false,
    },
    position: {
      type: [String, Array] as PropType<string | string[]>,
      default: () => {
        return defaults.position;
      },
    },
    classes: {
      type: [String, Array] as PropType<string | string[]>,
      default: 'vue-notification',
    },

    animationType: {
      type: String as PropType<'css' | 'velocity'>,
      default: 'css',
      validator(value) {
        return value === 'css' || value === 'velocity';
      },
    },

    animation: {
      type: Object as PropType<Record<'enter' | 'leave', unknown>>,
      default() {
        return defaults.velocityAnimation;
      },
    },

    animationName: {
      type: String,
      default: defaults.cssAnimation,
    },
    speed: {
      type: Number,
      default: 300,
    },
    /** Time (in ms) to keep the notification on screen (if **negative** - notification will stay **forever** or until clicked) */
    duration: {
      type: Number,
      default: 3000,
    },

    delay: {
      type: Number,
      default: 0,
    },

    max: {
      type: Number,
      default: Infinity,
    },

    ignoreDuplicates: {
      type: Boolean,
      default: false,
    },

    closeOnClick: {
      type: Boolean,
      default: true,
    },

    pauseOnHover: {
      type: Boolean,
      default: false,
    },
    /** Use [v-html](https://vuejs.org/api/built-in-directives.html#v-html) to set `title` and `text` */
    dangerouslySetInnerHtml: {
      type: Boolean,
      default: false,
    },
  },
  emits: {
    /* eslint-disable @typescript-eslint/no-unused-vars */
    click: (item: NotificationItem) => true,
    destroy: (item: NotificationItem) => true,
    start: (item: NotificationItem) => true,
    /* eslint-enable @typescript-eslint/no-unused-vars */
  },
  slots: Object as SlotsType<{
    body?: (props: { class: HTMLAttributes['class'], item: NotificationItem, close: () => void }) => any;
  }>,
  setup: (props, { emit, slots, expose }) => {
    const list = ref<NotificationItemExtended[]>([]);
    const velocity = params.get('velocity');

    const isVA = computed(() => {
      return props.animationType === 'velocity';
    });

    const active = computed<NotificationItemExtended[]>(() => {
      return list.value.filter(v => v.state !== STATE.DESTROYED);
    });

    const actualWidth = computed(() => {
      return parse(props.width);
    });

    const styles = computed(() => {
      const { x, y } = listToDirection(props.position);
      const width = actualWidth.value.value;
      const suffix = actualWidth.value.type;

      // eslint-disable-next-line no-shadow
      const styles: Record<string, string> = {
        width: width + suffix,
      };

      if (y) {
        styles[y] = '0px';
      }

      if (x) {
        if (x === 'center') {
          styles['left'] = `calc(50% - ${+width / 2}${suffix})`;
        } else {
          styles[x] = '0px';
        }

      }

      return styles;
    });

    const transitionGroupProps = computed<TransitionGroupProps>(() => {
      if (!isVA.value) {
        return {};
      }

      return {
        onEnter: handleEnter,
        onLeave: handleLeave,
        onAfterLeave: clean,
      };
    });

    const destroyIfNecessary = (item: NotificationItemExtended) => {
      emit('click', item);
      if (props.closeOnClick) {
        destroy(item);
      }
    };

    const pauseTimeout = (item: NotificationItemExtended): undefined => {
      if (props.pauseOnHover) {
        item.timer?.stop();
      }
    };
    const resumeTimeout = (item: NotificationItemExtended): undefined => {
      if (props.pauseOnHover) {
        item.timer?.start();
      }
    };
    const addItem = (event: NotificationsOptions = {}): void => {
      event.group ||= '';
      event.data ||= {};

      if (props.group !== event.group) {
        return;
      }

      if (event.clean || event.clear) {
        destroyAll();
        return;
      }

      const duration = typeof event.duration === 'number'
        ? event.duration
        : props.duration;

      const speed = typeof event.speed === 'number'
        ? event.speed
        : props.speed;

      const ignoreDuplicates = typeof event.ignoreDuplicates === 'boolean'
        ? event.ignoreDuplicates
        : props.ignoreDuplicates;

      const { title, text, type, data, id } = event;

      const item: NotificationItemExtended = {
        id: id || Id(),
        title,
        text,
        type,
        state: STATE.IDLE,
        speed,
        length: duration + 2 * speed,
        data,
        duplicates: 0,
      };

      if (duration >= 0) {
        item.timer = createTimer(() => destroy(item), item.length);
      }

      const botToTop = 'bottom' in styles.value;
      const direction = props.reverse
        ? !botToTop
        : botToTop;

      let indexToDestroy = -1;

      const duplicate = active.value.find(i => {
        return i.title === event.title && i.text === event.text;
      });

      if (ignoreDuplicates && duplicate) {
        duplicate.duplicates++;

        return;
      }

      if (direction) {
        list.value.push(item);
        emit('start', item);

        if (active.value.length > props.max) {
          indexToDestroy = 0;
        }
      } else {
        list.value.unshift(item);
        emit('start', item);

        if (active.value.length > props.max) {
          indexToDestroy = active.value.length - 1;
        }
      }

      if (indexToDestroy !== -1) {
        destroy(active.value[indexToDestroy]);
      }
    };
 
    const closeItem = (id: unknown) => {
      destroyById(id);
    };

    const notifyClass = (item: NotificationItemExtended): HTMLAttributes['class'] => {
      return [
        'vue-notification-template',
        props.classes,
        item.type || '',
      ];
    };

    const notifyWrapperStyle = (item: NotificationItemExtended) => {
      return isVA.value
        ? undefined
        : { transition: `all ${item.speed}ms` };
    };

    const destroy = (item: NotificationItemExtended): void => {
      item.timer?.stop();
      item.state = STATE.DESTROYED;

      clean();

      emit('destroy', item);
    };

    const destroyById = (id: unknown): void=>{
      const item = list.value.find(i => i.id === id);

      if (item) {
        destroy(item);
      }
    };

    const destroyAll = (): void => {
      active.value.forEach(destroy);
    };

    const getAnimation = (index: 'enter' | 'leave', el: Element)=> {
      const animation = props.animation?.[index];

      return typeof animation === 'function'
        ? animation(el)
        : animation;
    };

    const handleEnter = (el: Element, complete: () => void): void=> {
      const animation = getAnimation('enter', el);

      velocity(el, animation, {
        duration: props.speed,
        complete,
      });
    };

    const handleLeave = (el: Element, complete: () => void)=> {
      const animation = getAnimation('leave', el);

      velocity(el, animation, {
        duration: props.speed,
        complete,
      });
    };

    function clean() {
      list.value = list.value.filter(item => item.state !== STATE.DESTROYED);
    }


    onMounted(() => {
      emitter.on('add', addItem);
      emitter.on('close', closeItem);
    });

    onUnmounted(() => {
      emitter.off('add', addItem);
      emitter.off('close', closeItem);
    });

    if (import.meta.env.DEV) {
      expose({
        list,
        addItem,
      });
    }


    return () => (
      <div
        class='vue-notification-group'
        style={styles.value}
      >
        <TransitionGroup
          {...transitionGroupProps.value}
          tag='div'
          css={!isVA.value}
          name={props.animationName}
        >
          {
            active.value.map((item) => {
              return (
                <div
                  key={item.id}
                  class='vue-notification-wrapper'
                  style={notifyWrapperStyle(item)}
                  data-id={item.id}
                  onMouseenter={() => pauseTimeout(item)}
                  onMouseleave={() => resumeTimeout(item)}
                >
                  {
                    slots.body ? slots.body({
                      item,
                      class: [props.classes, item.type],
                      close: () => destroy(item),
                    }) : (
                      <div
                        class={notifyClass(item)}
                        onClick={() => destroyIfNecessary(item)}
                      >
                        {
                          props.dangerouslySetInnerHtml ? 
                            (
                              <>
                                {(item.title ? 
                                  <div
                                    class='notification-title'
                                    v-html={item.title} /> : null)}
                                <div class='notification-content' v-html={item.text} />
                              </>
                            )
                            : (
                              <>
                                {(item.title ? 
                                  <div class='notification-title'>
                                    { item.title }
                                  </div> : null)}
                                <div class='notification-content'>
                                  { item.text }
                                </div>
                              </>
                            )
                        }

                      </div>
                    )
                  }
                </div>
              );
            })
          }
      
        </TransitionGroup>
      </div>
    );
  },
});
